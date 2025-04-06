import type { Position } from 'vscode-languageserver-types';
import type { SSEProcessor } from '../openai/stream.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import { CancellationTokenSource } from 'vscode-languageserver/node.js';
import type { Context } from '../context.ts';
import type {
  BlockMode,
  CompletionResult,
  LanguageId,
  RepoInfo,
  TelemetryMeasurements,
  TelemetryProperties,
} from '../types.ts';
import type { Unknown } from '../types.ts';
import { CompletionResultType } from '../types.ts';
import type { APIChoice } from '../openai/openai.ts';
import type { ExtractedPrompt } from '../prompt/prompt.ts';
import type { Prompt, SnippetContext } from '../../../prompt/src/types.ts';
import type { RequestInfo } from '../openai/config.ts';

import { SHA256 } from 'crypto-js';
import { CompletionsCache } from './completionsCache.ts';
import { contextualFilterScore } from './contextualFilter.ts';
import { CurrentGhostText } from './current.ts';
import { requestMultilineScore } from './multilineModel.ts';
import { ChoiceSplitter, isProgressRevealChoice, isProgressiveRevealEnabled } from './progressiveReveal.ts';
import { mkBasicResultTelemetry, mkCanceledResultTelemetry, resultTypeToString } from './telemetry.ts';
import { AsyncCompletionManager } from '../asyncCompletion/manager.ts';
import { keyForPrompt } from '../common/cache.ts';
import { Debouncer } from '../common/debounce.ts';
import { asyncIterableFromArray, asyncIterableMapFilter } from '../common/iterableHelpers.ts';
import { BlockModeConfig, ConfigKey, getConfig, shouldDoParsingTrimming, shouldDoServerTrimming } from '../config.ts';
import { UserErrorNotifier } from '../error/userErrorNotifier.ts';
import { Features } from '../experiments/features.ts';
import { Logger } from '../logger.ts';
import { isAbortError } from '../networking.ts';
import { getEngineRequestInfo } from '../openai/config.ts';
import { OpenAIFetcher } from '../openai/fetch.ts';
import { getTemperatureForSamples } from '../openai/openai.ts';
import { StatusReporter } from '../progress.ts';
import {
  contextIndentation,
  isEmptyBlockStart,
  parsingBlockFinished,
  parsingBlockFinishedExtended,
} from '../prompt/parseBlock.ts';
import { extractPrompt, trimLastLine } from '../prompt/prompt.ts';
import { extractRepoInfoInBackground } from '../prompt/repository.ts';
import { ghostTextScoreConfidence, ghostTextScoreQuantile } from '../suggestions/restraint.ts';
import { checkSuffix, postProcessChoiceInContext } from '../suggestions/suggestions.ts';
import { TelemetryUserConfig } from '../telemetry/userConfig.ts';
import { TelemetryData, TelemetryWithExp, telemetrizePromptLength, telemetry } from '../telemetry.ts';
import { isRunningInTest, shouldFailForDebugPurposes } from '../testing/runtimeMode.ts';
import { CopilotTextDocument, LocationFactory } from '../textDocument.ts';
import { v4 as uuidv4 } from 'uuid';
import { isSupportedLanguageId } from '../../../prompt/src/parse.ts';
import type {} from './contextualFilterConstants.ts';

interface GhostTextOptions {
  isCycling: boolean;
  promptOnly: boolean;
  ifInserted?: { tooltipSignature?: SnippetContext['tooltipSignature'] };
  isSpeculative: boolean;
}

type RequestContext = {
  languageId: LanguageId;
  indentation?: { next?: number };
  blockMode: BlockMode;
  prompt: Prompt;
  multiline: boolean;
  // TODO maybe removed or optional
  // multiLogitBias: boolean;
  isCycling: boolean;
  repoInfo?: RepoInfo | 0; // computeInBackgroundAndMemoize not finished when 0
  ourRequestId: string;
  engineURL: string;
  headers: Record<string, string>;
  // TODO maybe removed or maybe optional
  // delayMs: number;
  prefix: string;

  requestForNextLine?: boolean;
};

type ProcessChoicesFunc<T> = (
  numGhostCompletions: number,
  requestStart: number,
  processingTime: number,
  choices: AsyncIterable<APIChoice>
) => Promise<CompletionResult<T>>;

type Result = {
  completion: {
    completionIndex: number;
    displayText: string;
    completionText: string;
    displayNeedsWsOffset: boolean;
  };
  // TelemetryWithExp ./copilotCompletion.ts
  telemetry: TelemetryWithExp;
  isMiddleOfTheLine: boolean;
  suffixCoverage: number;
  // TelemetryWithExp ./copilotCompletion.ts
  copilotAnnotations?: { ip_code_citations?: Unknown.Annotation[] };
};

type GhostTextResult = CompletionResult<[Result[], CompletionResultType]>;

async function genericGetCompletionsFromNetwork<T>(
  ctx: Context,
  requestContext: RequestContext,
  baseTelemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken,
  finishedCb: SSEProcessor.FinishedCb,
  what: string,
  processChoices: ProcessChoicesFunc<T>
): Promise<CompletionResult<T>> {
  ghostTextLogger.debug(ctx, `Getting ${what} from network`);
  baseTelemetryData = baseTelemetryData.extendedBy();
  const numGhostCompletions = await getNumGhostCompletions(ctx, requestContext, baseTelemetryData);
  const temperature = getTemperatureForSamples(ctx, numGhostCompletions);

  const postOptions: OpenAIFetcher.CompletionParams['postOptions'] = {
    stream: true,
    n: numGhostCompletions,
    temperature,
    extra: {
      language: requestContext.languageId,
      next_indent: requestContext.indentation?.next ?? 0,
      trim_by_indentation: shouldDoServerTrimming(requestContext.blockMode),
      prompt_tokens: requestContext.prompt?.prefixTokens ?? 0,
      suffix_tokens: requestContext.prompt?.suffixTokens ?? 0,
    },
  };

  if (!requestContext.multiline) {
    postOptions.stop = ['\n'];
  }

  const requestStart = Date.now();
  const newProperties: TelemetryProperties = {
    endpoint: 'completions',
    uiKind: 'ghostText',
    temperature: JSON.stringify(temperature),
    n: JSON.stringify(numGhostCompletions),
    stop: JSON.stringify(postOptions.stop ?? 'unset'),
    logit_bias: JSON.stringify(postOptions.logit_bias ?? null),
  };

  Object.assign(baseTelemetryData.properties, newProperties);

  try {
    const completionParams: OpenAIFetcher.CompletionParams = {
      prompt: requestContext.prompt,
      languageId: requestContext.languageId,
      repoInfo: requestContext.repoInfo,
      ourRequestId: requestContext.ourRequestId,
      engineUrl: requestContext.engineURL,
      count: numGhostCompletions,
      uiKind: 'ghostText',
      postOptions,
      headers: requestContext.headers,
    };

    const res = await ctx
      .get(OpenAIFetcher)
      .fetchAndStreamCompletions(ctx, completionParams, baseTelemetryData, finishedCb, cancellationToken);

    if (res.type === 'failed') {
      return { type: 'failed', reason: res.reason, telemetryData: mkBasicResultTelemetry(baseTelemetryData) };
    }
    if (res.type === 'canceled') {
      ghostTextLogger.debug(ctx, 'Cancelled after awaiting fetchCompletions');
      return { type: 'canceled', reason: res.reason, telemetryData: mkCanceledResultTelemetry(baseTelemetryData) };
    }
    const trimmedChoices = isProgressiveRevealEnabled(ctx, baseTelemetryData)
      ? trimChoicesForProgressiveReveal(ctx, requestContext, baseTelemetryData, res.choices)
      : res.choices;
    return processChoices(numGhostCompletions, requestStart, res.getProcessingTime(), trimmedChoices);
  } catch (err) {
    if (isAbortError(err)) {
      return {
        type: 'canceled',
        reason: 'network request aborted',
        telemetryData: mkCanceledResultTelemetry(baseTelemetryData, { cancelledNetworkRequest: true }),
      };
    }

    ghostTextLogger.exception(ctx, err, 'Error on ghost text request');
    ctx.get(UserErrorNotifier).notifyUser(ctx, err);

    if (shouldFailForDebugPurposes(ctx)) {
      throw err;
    }

    return {
      type: 'failed',
      reason: 'non-abort error on ghost text request',
      telemetryData: mkBasicResultTelemetry(baseTelemetryData),
    };
  }
}

function postProcessChoices(newChoice: APIChoice, currentChoices: APIChoice[] = []): APIChoice | undefined {
  newChoice.completionText = newChoice.completionText.trimEnd();
  if (
    !!newChoice.completionText &&
    currentChoices.findIndex((v) => v.completionText.trim() === newChoice.completionText.trim()) === -1
  ) {
    return newChoice;
  }
}

async function* trimChoicesForProgressiveReveal(
  ctx: Context,
  requestContext: RequestContext,
  telemetryWithExp: TelemetryWithExp,
  choices: AsyncIterable<APIChoice>
) {
  for await (const choice of choices) {
    const choices = new ChoiceSplitter(
      ctx,
      requestContext.prefix,
      requestContext.prompt.prefix,
      telemetryWithExp,
      choice
    ).choices();

    const firstChoice = choices.next().value;
    if (firstChoice) {
      for (const nextChoice of choices) {
        const newContext = {
          ...requestContext,
          prefix: nextChoice.docPrefix,
          prompt: { ...requestContext.prompt, prefix: nextChoice.promptPrefix },
        };
        appendToCache(ctx, newContext, { multiline: requestContext.multiline, choices: [nextChoice.choice] });
      }
      yield firstChoice.choice;
    }
  }
}

async function getCompletionsFromNetwork(
  ctx: Context,
  requestContext: RequestContext,
  baseTelemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken,
  finishedCb: SSEProcessor.FinishedCb
): Promise<CompletionResult<[APIChoice, Promise<void>]>> {
  return genericGetCompletionsFromNetwork<[APIChoice, Promise<void>]>(
    ctx,
    requestContext,
    baseTelemetryData,
    cancellationToken,
    finishedCb,
    'completions',
    async (
      numGhostCompletions: number,
      requestStart: number,
      processingTime: number,
      choicesStream: AsyncIterable<APIChoice>
    ): Promise<CompletionResult<[APIChoice, Promise<void>]>> => {
      const firstRes = await choicesStream[Symbol.asyncIterator]().next();

      if (firstRes.done) {
        ghostTextLogger.debug(ctx, 'All choices redacted');
        return {
          type: 'empty',
          reason: 'all choices redacted',
          telemetryData: mkBasicResultTelemetry(baseTelemetryData),
        };
      }
      if (cancellationToken?.isCancellationRequested) {
        ghostTextLogger.debug(ctx, 'Cancelled after awaiting redactedChoices iterator');
        return {
          type: 'canceled',
          reason: 'after awaiting redactedChoices iterator',
          telemetryData: mkCanceledResultTelemetry(baseTelemetryData),
        };
      }
      const firstChoice = firstRes.value;
      if (firstChoice === undefined) {
        ghostTextLogger.debug(ctx, 'Got undefined choice from redactedChoices iterator');
        return {
          type: 'empty',
          reason: 'got undefined choice from redactedChoices iterator',
          telemetryData: mkBasicResultTelemetry(baseTelemetryData),
        };
      }
      telemetryPerformance(ctx, 'performance', firstChoice, requestStart, processingTime);
      ghostTextLogger.debug(ctx, `Awaited first result, id: ${firstChoice.choiceIndex}`);
      const processedFirstChoice = postProcessChoices(firstChoice);

      if (processedFirstChoice) {
        appendToCache(ctx, requestContext, { multiline: requestContext.multiline, choices: [processedFirstChoice] });

        ghostTextLogger.debug(
          ctx,
          `GhostText first completion (index ${processedFirstChoice?.choiceIndex}): ${JSON.stringify(processedFirstChoice?.completionText)}`
        );
      }

      const cacheDone = (async () => {
        const apiChoices = processedFirstChoice !== undefined ? [processedFirstChoice] : [];
        for await (const choice of choicesStream) {
          if (choice === undefined) {
            continue;
          }
          ghostTextLogger.debug(
            ctx,
            `GhostText later completion (index ${choice?.choiceIndex}): ${JSON.stringify(choice.completionText)}`
          );
          const processedChoice = postProcessChoices(choice, apiChoices);

          if (processedChoice) {
            apiChoices.push(processedChoice);
            appendToCache(ctx, requestContext, { multiline: requestContext.multiline, choices: [processedChoice] });
          }
        }
      })();

      if (isRunningInTest(ctx)) {
        await cacheDone;
      }

      return processedFirstChoice
        ? {
            type: 'success',
            value: [makeGhostAPIChoice(processedFirstChoice, { forceSingleLine: false }), cacheDone] as [
              APIChoice,
              Promise<void>,
            ],
            telemetryData: mkBasicResultTelemetry(baseTelemetryData),
            telemetryBlob: baseTelemetryData,
            resultType: 0,
          }
        : {
            type: 'empty',
            reason: 'got undefined processedFirstChoice',
            telemetryData: mkBasicResultTelemetry(baseTelemetryData),
          };
    }
  );
}

async function getAllCompletionsFromNetwork(
  ctx: Context,
  requestContext: RequestContext,
  baseTelemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken,
  finishedCb: SSEProcessor.FinishedCb
): Promise<CompletionResult<[APIChoice[], Promise<void>]>> {
  return genericGetCompletionsFromNetwork<[APIChoice[], Promise<void>]>(
    ctx,
    requestContext,
    baseTelemetryData,
    cancellationToken,
    finishedCb,
    'all completions',
    async (
      numGhostCompletions: number,
      requestStart: number,
      processingTime: number,
      choicesStream: AsyncIterable<APIChoice>
    ): Promise<CompletionResult<[APIChoice[], Promise<void>]>> => {
      const apiChoices: APIChoice[] = [];
      for await (const choice of choicesStream) {
        if (cancellationToken?.isCancellationRequested) {
          ghostTextLogger.debug(ctx, 'Cancelled after awaiting choices iterator');
          return {
            type: 'canceled',
            reason: 'after awaiting choices iterator',
            telemetryData: mkCanceledResultTelemetry(baseTelemetryData),
          };
        }

        const processedChoice = postProcessChoices(choice, apiChoices);

        if (processedChoice) {
          apiChoices.push(processedChoice);
        }
      }

      if (apiChoices.length > 0) {
        appendToCache(ctx, requestContext, { multiline: requestContext.multiline, choices: apiChoices });
        telemetryPerformance(ctx, 'cyclingPerformance', apiChoices[0], requestStart, processingTime);
      }
      return {
        type: 'success',
        value: [apiChoices, Promise.resolve()],
        telemetryData: mkBasicResultTelemetry(baseTelemetryData),
        telemetryBlob: baseTelemetryData,
        resultType: CompletionResultType.Cycling,
      };
    }
  );
}

function makeGhostAPIChoice(choice: APIChoice, options: { forceSingleLine: boolean }): APIChoice {
  const ghostChoice = { ...choice };
  if (options.forceSingleLine) {
    const { completionText } = ghostChoice;

    if (completionText?.[0] === '\n') {
      ghostChoice.completionText = '\n' + completionText.split('\n')[1];
    } else {
      ghostChoice.completionText = completionText.split('\n')[0];
    }
  }
  return ghostChoice;
}

async function getNumGhostCompletions(
  ctx: Context,
  requestContext: RequestContext,
  telemetryData: TelemetryWithExp
): Promise<number> {
  const override = ctx.get(Features).overrideNumGhostCompletions(telemetryData);
  if (override) {
    return requestContext.isCycling ? Math.max(3, override) : override;
  } else {
    if (shouldDoParsingTrimming(requestContext.blockMode) && requestContext.multiline) {
      return 3;
    } else if (requestContext.isCycling) {
      return 2;
    }
    return 1;
  }
}

async function getGhostTextStrategy(
  ctx: Context,
  document: CopilotTextDocument,
  position: Position,
  prompt: Extract<ExtractedPrompt, { type: 'prompt' }>,
  isCycling: boolean,
  inlineSuggestion: boolean,
  requestForNextLine: boolean | undefined,
  preIssuedTelemetryData: TelemetryWithExp
): Promise<{
  blockMode: BlockMode;
  requestMultiline: boolean;
  isCyclingRequest: boolean;
  finishedCb: SSEProcessor.FinishedCb;
}> {
  const blockMode = await ctx.get(BlockModeConfig).forLanguage(ctx, document.languageId, preIssuedTelemetryData);
  switch (blockMode) {
    case 'server':
      return {
        blockMode: 'server',
        requestMultiline: true,
        isCyclingRequest: isCycling,
        finishedCb: async (_) => undefined,
      };
    case 'parsing':
    case 'parsingandserver':
    case 'moremultiline':
    default: {
      if (
        await shouldRequestMultiline(ctx, blockMode, document, position, inlineSuggestion, requestForNextLine, prompt)
      ) {
        let adjustedPosition;

        if (prompt.trailingWs.length > 0 && !prompt.prompt.prefix.endsWith(prompt.trailingWs)) {
          adjustedPosition = LocationFactory.position(
            position.line,
            Math.max(position.character - prompt.trailingWs.length, 0)
          );
        } else {
          adjustedPosition = position;
        }

        return {
          blockMode,
          requestMultiline: true,
          isCyclingRequest: false,
          finishedCb:
            blockMode == 'moremultiline'
              ? parsingBlockFinishedExtended(ctx, document, adjustedPosition, 2, 15, 8)
              : parsingBlockFinished(ctx, document, adjustedPosition),
        };
      }
      return {
        blockMode,
        requestMultiline: false,
        isCyclingRequest: isCycling,
        finishedCb: async (_) => undefined,
      };
    }
  }
}

async function getGhostTextWithoutAbortHandling(
  ctx: Context,
  document: CopilotTextDocument,
  position: Position,
  preIssuedTelemetryData: TelemetryData,
  cancellationToken: CancellationToken,
  options: Partial<GhostTextOptions>,
  data: unknown
): Promise<GhostTextResult> {
  const ghostTextOptions = { ...defaultOptions, ...options };
  const ourRequestId = uuidv4();
  preIssuedTelemetryData = preIssuedTelemetryData.extendedBy({ headerRequestId: ourRequestId });
  const currentGhostText = ctx.get(CurrentGhostText);
  const currentClientCompletionId = currentGhostText.clientCompletionId;
  const features = ctx.get(Features);
  let preIssuedTelemetryDataWithExp;

  if (preIssuedTelemetryData instanceof TelemetryWithExp) {
    preIssuedTelemetryDataWithExp = preIssuedTelemetryData;
  } else {
    preIssuedTelemetryDataWithExp = await features.updateExPValuesAndAssignments(
      { uri: document.uri, languageId: document.detectedLanguageId },
      preIssuedTelemetryData
    );
  }

  const telemetryConfig = ctx.get(TelemetryUserConfig);

  if (telemetryConfig.trackingId) {
    preIssuedTelemetryDataWithExp = preIssuedTelemetryDataWithExp.extendedBy({
      copilot_trackingId: telemetryConfig.trackingId,
    });
  }

  const inlineSuggestion = isInlineSuggestion(document, position);
  if (inlineSuggestion === undefined) {
    ghostTextLogger.debug(ctx, 'Breaking, invalid middle of the line');
    return {
      type: 'abortedBeforeIssued',
      reason: 'Invalid middle of the line',
      telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
    };
  }

  const asyncCompletions = ctx.get(AsyncCompletionManager).isEnabled(preIssuedTelemetryDataWithExp)
    ? ctx.get(AsyncCompletionManager)
    : undefined;

  const originalCancellationToken = cancellationToken;

  if (asyncCompletions) {
    cancellationToken = new CancellationTokenSource().token;
  }

  const prompt = await extractPrompt(
    ctx,
    document,
    position,
    preIssuedTelemetryDataWithExp,
    cancellationToken,
    ghostTextOptions.ifInserted,
    data
  );

  if (prompt.type === 'copilotContentExclusion') {
    ghostTextLogger.debug(ctx, 'Copilot not available, due to content exclusion');
    return {
      type: 'abortedBeforeIssued',
      reason: 'Copilot not available due to content exclusion',
      telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
    };
  }

  if (prompt.type === 'contextTooShort') {
    ghostTextLogger.debug(ctx, 'Breaking, not enough context');
    return {
      type: 'abortedBeforeIssued',
      reason: 'Not enough context',
      telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
    };
  }

  if (prompt.type === 'promptError') {
    ghostTextLogger.debug(ctx, 'Error while building the prompt');
    return {
      type: 'abortedBeforeIssued',
      reason: 'Error while building the prompt',
      telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
    };
  }

  if (ghostTextOptions.promptOnly) {
    return {
      type: 'promptOnly',
      reason: 'Breaking, promptOnly set to true',
      prompt,
    };
  }

  if (prompt.type === 'promptCancelled') {
    ghostTextLogger.debug(ctx, 'Cancelled during extractPrompt');
    return {
      type: 'abortedBeforeIssued',
      reason: 'Cancelled during extractPrompt',
      telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
    };
  }

  if (prompt.prompt.prefix.length === 0 && prompt.prompt.suffix.length === 0) {
    ghostTextLogger.debug(ctx, 'Error empty prompt');
    return {
      type: 'abortedBeforeIssued',
      reason: 'Empty prompt',
      telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
    };
  }

  if (cancellationToken?.isCancellationRequested) {
    ghostTextLogger.debug(ctx, 'Cancelled after extractPrompt');
    return {
      type: 'abortedBeforeIssued',
      reason: 'Cancelled after extractPrompt',
      telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
    };
  }

  return ctx.get(StatusReporter).withProgress(async () => {
    const [prefix] = trimLastLine(document.getText(LocationFactory.range(LocationFactory.position(0, 0), position)));

    const requestForNextLine = features.triggerCompletionAfterAccept(preIssuedTelemetryDataWithExp)
      ? ctx.get(CurrentGhostText).hasAcceptedCurrentCompletion(prefix, prompt.prompt.suffix)
      : undefined;

    if (requestForNextLine) {
      prompt.prompt = {
        ...prompt.prompt,
        prefix: prompt.prompt.prefix + '\n',
      };
    }

    const ghostTextStrategy = await getGhostTextStrategy(
      ctx,
      document,
      position,
      prompt,
      ghostTextOptions.isCycling,
      inlineSuggestion,
      requestForNextLine ?? false,
      preIssuedTelemetryDataWithExp
    );

    if (cancellationToken?.isCancellationRequested) {
      ghostTextLogger.debug(ctx, 'Cancelled after requestMultiline');
      return {
        type: 'abortedBeforeIssued',
        reason: 'Cancelled after requestMultiline',
        telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
      };
    }

    let choices = getLocalInlineSuggestion(ctx, prefix, prompt.prompt, ghostTextStrategy.requestMultiline);

    const repoInfo = extractRepoInfoInBackground(ctx, document.uri);
    const engineInfo = await getEngineRequestInfo(ctx, preIssuedTelemetryDataWithExp);

    const requestContext = {
      blockMode: ghostTextStrategy.blockMode,
      languageId: document.languageId,
      repoInfo,
      engineURL: engineInfo.url,
      ourRequestId,
      prefix,
      prompt: prompt.prompt,
      multiline: ghostTextStrategy.requestMultiline,
      indentation: contextIndentation(document, position),
      isCycling: ghostTextOptions.isCycling,
      headers: engineInfo.headers,
      requestForNextLine,
    };

    const telemetryData = telemetryIssued(
      ctx,
      document,
      requestContext,
      position,
      prompt,
      preIssuedTelemetryDataWithExp,
      engineInfo
    );

    const speculativeConfig = getConfig(ctx, ConfigKey.EnableSpeculativeRequests);
    const speculativeFlag = features.enableSpeculativeRequests(preIssuedTelemetryDataWithExp);

    const speculativeEnabled =
      (speculativeConfig || speculativeFlag) && !ghostTextOptions.isSpeculative && !ghostTextStrategy.isCyclingRequest;
    let allChoicesPromise: Promise<void> = Promise.resolve();
    if (
      asyncCompletions &&
      choices === undefined &&
      !ghostTextStrategy.isCyclingRequest &&
      !asyncCompletions.shouldWaitForAsyncCompletions(prompt.prompt)
    ) {
      const choice = await asyncCompletions.getFirstMatchingRequestWithTimeout(prompt.prompt);
      if (choice) {
        const forceSingleLine = !ghostTextStrategy.requestMultiline;
        choices = [[makeGhostAPIChoice(choice[0], { forceSingleLine })], 4];
        allChoicesPromise = choice[1];
      }
      if (originalCancellationToken?.isCancellationRequested) {
        ghostTextLogger.debug(ctx, 'Cancelled before requesting a new completion');
        return {
          type: 'abortedBeforeIssued',
          reason: 'Cancelled after waiting for async completion',
          telemetryData: mkBasicResultTelemetry(telemetryData),
        };
      }
    }
    if (choices !== undefined && (!ghostTextStrategy.isCyclingRequest || choices[0].length > 1)) {
      ghostTextLogger.debug(ctx, `Found inline suggestions locally via ${resultTypeToString(choices[1])}`);
    } else if (ghostTextStrategy.isCyclingRequest) {
      const networkChoices = await getAllCompletionsFromNetwork(
        ctx,
        requestContext,
        telemetryData,
        cancellationToken,
        ghostTextStrategy.finishedCb
      );
      if (networkChoices.type === 'success') {
        const resultChoices = choices?.[0] ?? [];

        networkChoices.value[0].forEach((c) => {
          if (resultChoices.findIndex((v) => v.completionText.trim() === c.completionText.trim()) === -1) {
            resultChoices.push(c);
          }
        });

        choices = [resultChoices, 3];
      } else if (choices === undefined) {
        return networkChoices;
      }
    } else {
      const debounceThreshold = features.debounceThreshold(preIssuedTelemetryDataWithExp);
      if (!(asyncCompletions !== undefined || requestContext.requestForNextLine === true || debounceThreshold === 0)) {
        try {
          await ghostTextDebouncer.debounce(debounceThreshold);
        } catch {
          return {
            type: 'canceled',
            reason: 'by debouncer',
            telemetryData: mkCanceledResultTelemetry(telemetryData),
          };
        }
        if (cancellationToken?.isCancellationRequested) {
          ghostTextLogger.debug(ctx, 'Cancelled during debounce');
          return {
            type: 'canceled',
            reason: 'during debounce',
            telemetryData: mkCanceledResultTelemetry(telemetryData),
          };
        }
      }
      if (cancellationToken?.isCancellationRequested) {
        ghostTextLogger.debug(ctx, 'Cancelled before contextual filter');
        return {
          type: 'canceled',
          reason: 'before contextual filter',
          telemetryData: mkCanceledResultTelemetry(telemetryData),
        };
      }
      if (
        !features.disableContextualFilter(preIssuedTelemetryDataWithExp) &&
        telemetryData.measurements.contextualFilterScore < 35 / 100
      ) {
        ghostTextLogger.debug(ctx, 'Cancelled by contextual filter');
        return {
          type: 'canceled',
          reason: 'contextualFilterScore below threshold',
          telemetryData: mkCanceledResultTelemetry(telemetryData),
        };
      }
      const requestPromise = getCompletionsFromNetwork(
        ctx,
        requestContext,
        telemetryData,
        cancellationToken,
        ghostTextStrategy.finishedCb
      );
      if (asyncCompletions) {
        asyncCompletions.queueCompletionRequest(prompt.prompt, requestPromise); // TODO check requestPromise later
        const c = await asyncCompletions.getFirstMatchingRequest(prompt.prompt);
        if (c === undefined) {
          return {
            type: 'empty',
            reason: 'received no results from async completions',
            telemetryData: mkBasicResultTelemetry(telemetryData),
          };
        }
        choices = [[c[0]], 4];
        allChoicesPromise = c[1];
      } else {
        const c = await requestPromise;
        if (c.type !== 'success') {
          return c;
        }
        choices = [[c.value[0]], 0];
        allChoicesPromise = c.value[1];
      }
    }
    if (choices === undefined) {
      return {
        type: 'failed',
        reason: 'internal error: choices should be defined after network call',
        telemetryData: mkBasicResultTelemetry(telemetryData),
      };
    }
    const [choicesArray, resultType] = choices;

    const postProcessedChoices = asyncIterableMapFilter(asyncIterableFromArray(choicesArray), async (choice) => {
      return postProcessChoiceInContext(
        ctx,
        document,
        position,
        choice,
        requestContext.requestForNextLine ?? false,
        ghostTextLogger
      );
    });

    const postProcessedChoicesArray = [];
    const results: Result[] = [];
    for await (const choice of postProcessedChoices) {
      postProcessedChoicesArray.push(choice);
      if (originalCancellationToken?.isCancellationRequested) {
        ghostTextLogger.debug(ctx, 'Cancelled after post processing completions');
        return {
          type: 'canceled',
          reason: 'after post processing completions',
          telemetryData: mkCanceledResultTelemetry(telemetryData),
        };
      }

      const choiceTelemetryData = telemetryWithAddData(ctx, document, requestContext, choice, telemetryData);

      const suffixCoverage = inlineSuggestion ? checkSuffix(document, position, choice) : 0;

      const res: Result = {
        completion: adjustLeadingWhitespace(choice.choiceIndex, choice.completionText, prompt.trailingWs),
        telemetry: choiceTelemetryData,
        isMiddleOfTheLine: inlineSuggestion,
        suffixCoverage,
        copilotAnnotations: choice.copilotAnnotations,
      };

      results.push(res);
    }

    telemetryData.measurements.foundOffset = results?.[0]?.telemetry?.measurements?.foundOffset ?? -1;

    ghostTextLogger.debug(
      ctx,
      `Produced ${results.length} results from ${resultTypeToString(resultType)} at ${telemetryData.measurements.foundOffset} offset`
    );

    if (speculativeEnabled) {
      const documentOffset = document.offsetAt(position);
      const documentText = document.getText();

      const newDocumentText =
        documentText.slice(0, documentOffset) +
        results[0].completion.completionText +
        documentText.slice(documentOffset);

      const newDocument = CopilotTextDocument.create(
        document.uri.toString(),
        document.clientLanguageId,
        document.version - 1,
        newDocumentText,
        document.detectedLanguageId
      );

      const newPosition = newDocument.positionAt(documentOffset + results[0].completion.completionText.length);

      const newTelemetryData = TelemetryData.createAndMarkAsIssued(
        { ...preIssuedTelemetryData.properties, reason: 'speculative' },
        preIssuedTelemetryData.measurements
      );

      const newCancellationToken = new CancellationTokenSource().token;
      allChoicesPromise.then(() => {
        getGhostText(ctx, newDocument, newPosition, newTelemetryData, newCancellationToken, {
          isSpeculative: true,
        });
      });
    }
    if (currentClientCompletionId !== currentGhostText.clientCompletionId) {
      const choicesTyping = currentGhostText.getCompletionsForUserTyping(prefix, prompt.prompt.suffix);
      if ((choicesTyping?.length ?? 0) > 0) {
        ghostTextLogger.warn(ctx, 'Current completion changed before returning');
        return {
          type: 'canceled',
          reason: 'current completion changed before returning',
          telemetryData: mkCanceledResultTelemetry(telemetryData),
        };
      }
    }

    if (!ghostTextOptions.isSpeculative) {
      currentGhostText.setGhostText(prefix, prompt.prompt.suffix, postProcessedChoicesArray, resultType);
    }

    return {
      type: 'success',
      value: [results, resultType],
      telemetryData: mkBasicResultTelemetry(telemetryData),
      telemetryBlob: telemetryData,
      resultType,
    };
  });
}

async function getGhostText(
  ctx: Context,
  textDocument: CopilotTextDocument,
  position: Position,
  telemetryData: TelemetryData,
  token: CancellationToken,
  options: Partial<GhostTextOptions>,
  data?: unknown
): Promise<GhostTextResult> {
  try {
    return await getGhostTextWithoutAbortHandling(ctx, textDocument, position, telemetryData, token, options, data);
  } catch (e) {
    if (isAbortError(e)) {
      return {
        type: 'canceled',
        reason: 'aborted at unknown location',
        telemetryData: mkCanceledResultTelemetry(telemetryData, { cancelledNetworkRequest: true }),
      };
    }
    throw e;
  }
}

function getLocalInlineSuggestion(
  ctx: Context,
  prefix: string,
  prompt: Prompt,
  requestMultiline: boolean
): [APIChoice[], CompletionResultType] | undefined {
  const choicesTyping = ctx.get(CurrentGhostText).getCompletionsForUserTyping(prefix, prompt.suffix);
  const choicesCache = getCompletionsFromCache(ctx, prefix, prompt, requestMultiline);
  if (choicesTyping && choicesTyping.length > 0) {
    const choicesCacheDeduped = (choicesCache ?? []).filter(
      (c) => !choicesTyping.some((t) => t.completionText === c.completionText)
    );
    return [choicesTyping.concat(choicesCacheDeduped), CompletionResultType.TypingAsSuggested];
  }
  if (choicesCache && choicesCache.length > 0) {
    return [choicesCache, CompletionResultType.Cache];
  }
}

function isInlineSuggestion(document: CopilotTextDocument, position: Position): boolean | undefined {
  const isMiddleOfLine = isMiddleOfTheLine(position, document);
  const isValidMiddleOfLine = isValidMiddleOfTheLinePosition(position, document);
  return isMiddleOfLine && !isValidMiddleOfLine ? undefined : isMiddleOfLine && isValidMiddleOfLine;
}

function isMiddleOfTheLine(selectionPosition: Position, doc: CopilotTextDocument) {
  return doc.lineAt(selectionPosition).text.substring(selectionPosition.character).trim().length !== 0;
}

function isValidMiddleOfTheLinePosition(selectionPosition: Position, doc: CopilotTextDocument) {
  const endOfLine = doc.lineAt(selectionPosition).text.substring(selectionPosition.character).trim();
  return /^\s*[)>}\]"'`]*\s*[:{;,]?\s*$/.test(endOfLine);
}

function isNewLine(selectionPosition: Position, doc: CopilotTextDocument) {
  return doc.lineAt(selectionPosition).text.trim().length === 0;
}

async function shouldRequestMultiline(
  ctx: Context,
  blockMode: BlockMode,
  document: CopilotTextDocument,
  position: Position,
  inlineSuggestion: boolean,
  requestForNextLine: boolean | undefined,
  prompt: Extract<ExtractedPrompt, { type: 'prompt' }>
): Promise<boolean> {
  if (ctx.get(ForceMultiLine).requestMultilineOverride) {
    return true;
  }
  if (document.lineCount >= 8000) {
    telemetry(
      ctx,
      'ghostText.longFileMultilineSkip',
      TelemetryData.createAndMarkAsIssued({
        languageId: document.languageId,
        lineCount: String(document.lineCount),
        currentLine: String(position.line),
      })
    );
    return false;
  }

  if (blockMode == 'moremultiline') {
    return true;
  }

  if (requestForNextLine) {
    let indentation = contextIndentation(document, position);
    let whitespaceChar = indentation.current > 0 ? document.lineAt(position).text[0] : undefined;

    let change = {
      range: { start: position, end: position },
      text: '\n' + (whitespaceChar ? whitespaceChar.repeat(indentation.current) : ''),
    };

    document = CopilotTextDocument.withChanges(document, [change], document.version + 1);
  }

  if (['typescript', 'typescriptreact'].includes(document.languageId) && isNewLine(position, document)) {
    return true;
  }

  let requestMultiline = false;

  // if (!inlineSuggestion && isSupportedLanguageId(document.languageId)) {
  //   requestMultiline = await isEmptyBlockStart(document, position);
  // } else {
  //   if (inlineSuggestion && isSupportedLanguageId(document.languageId)) {
  //     requestMultiline =
  //       (await isEmptyBlockStart(document, position)) ||
  //       (await isEmptyBlockStart(document, document.lineAt(position).range.end));
  //   }
  // }

  // EDITED
  if (isSupportedLanguageId(document.languageId)) {
    requestMultiline = await isEmptyBlockStart(document, position);
    if (inlineSuggestion) {
      requestMultiline = requestMultiline || (await isEmptyBlockStart(document, document.lineAt(position).range.end));
    }
  }

  if (!requestMultiline && ['javascript', 'javascriptreact', 'python'].includes(document.languageId)) {
    requestMultiline = requestMultilineScore(prompt.prompt, document.languageId) > 0.5;
  }

  return requestMultiline;
}

function appendToCache(
  ctx: Context,
  requestContext: RequestContext,
  newContents: { multiline: boolean; choices: APIChoice[] }
): void {
  const promptHash = keyForPrompt(requestContext.prompt);
  const existing = ctx.get(CompletionsCache).get(promptHash);

  if (existing?.multiline === newContents.multiline) {
    ctx.get(CompletionsCache).set(promptHash, {
      multiline: existing.multiline,
      choices: existing.choices.concat(newContents.choices),
    });
  } else {
    ctx.get(CompletionsCache).set(promptHash, newContents);
  }

  ghostTextLogger.debug(
    ctx,
    `Appended ${newContents.choices.length} cached ghost text for key: ${promptHash}, multiline: ${newContents.multiline}, total number of suggestions: ${(existing?.choices.length ?? 0) + newContents.choices.length}`
  );
}

function getCachedChoices(ctx: Context, promptHash: string, multiline: boolean): APIChoice[] | undefined {
  const contents = ctx.get(CompletionsCache).get(promptHash);
  if (contents && !(multiline && !contents.multiline)) {
    return contents.choices;
  }
}

function adjustLeadingWhitespace(index: number, text: string, ws: string): Result['completion'] {
  if (ws.length > 0) {
    if (text.startsWith(ws)) {
      return {
        completionIndex: index,
        completionText: text,
        displayText: text.substring(ws.length),
        displayNeedsWsOffset: false,
      };
    }
    const textLeftWs = text.substring(0, text.length - text.trimStart().length);
    return ws.startsWith(textLeftWs)
      ? {
          completionIndex: index,
          completionText: text,
          displayText: text.trimStart(),
          displayNeedsWsOffset: true,
        }
      : {
          completionIndex: index,
          completionText: text,
          displayText: text,
          displayNeedsWsOffset: false,
        };
  } else {
    return {
      completionIndex: index,
      completionText: text,
      displayText: text,
      displayNeedsWsOffset: false,
    };
  }
}

function getCompletionsFromCache(
  ctx: Context,
  currentPrefix: string,
  prompt: Prompt,
  multiline: boolean
): APIChoice[] | undefined {
  for (let i = 0; i < MAX_COMPLETION_CACHE_PREFIX_BACKTRACK; i++) {
    const choices = [];
    const prefix = prompt.prefix.substring(0, prompt.prefix.length - i);
    const promptHash = keyForPrompt({ prefix, suffix: prompt.suffix });
    const cachedChoices = getCachedChoices(ctx, promptHash, multiline);
    if (!cachedChoices) {
      continue;
    }
    ghostTextLogger.debug(
      ctx,
      `Got completions from cache at ${i} characters back for key: ${promptHash}, multiline: ${multiline}`
    );
    const remainingPrefix = prompt.prefix.substring(prefix.length);
    for (const choice of cachedChoices) {
      let completionText = choice.completionText;
      if (!completionText.startsWith(remainingPrefix) || completionText.length <= remainingPrefix.length) {
        continue;
      }
      completionText = completionText.substring(remainingPrefix.length);
      const choiceToReturn = makeGhostAPIChoice(
        { ...choice, completionText },
        { forceSingleLine: !multiline && !isProgressRevealChoice(choice) }
      );
      choiceToReturn.telemetryData.measurements.foundOffset = i;

      if (choiceToReturn.completionText !== '') {
        choices.push(choiceToReturn);
      }
    }
    ghostTextLogger.debug(ctx, `Found ${choices.length} matching completions from cache at ${i} characters back`);
    if (choices.length > 0) {
      return choices;
    }
  }
  return [];
}

// APIChoice TelemetryWithExp ../../../agent/src/methods/getCompletions.ts
function telemetryWithAddData(
  ctx: Context,
  document: CopilotTextDocument,
  requestContext: RequestContext,
  choice: APIChoice,
  issuedTelemetryData: TelemetryWithExp
): TelemetryWithExp {
  const requestId = choice.requestId;
  const properties: TelemetryProperties = { choiceIndex: choice.choiceIndex.toString() };
  const numLines = choice.completionText.split('\n').length;

  const measurements: TelemetryMeasurements = {
    compCharLen: choice.completionText.length,
    numLines: requestContext.requestForNextLine ? numLines - 1 : numLines,
  };

  if (choice.meanLogProb) {
    measurements.meanLogProb = choice.meanLogProb;
  }

  if (choice.meanAlternativeLogProb) {
    measurements.meanAlternativeLogProb = choice.meanAlternativeLogProb;
  }

  let extendedTelemetry = choice.telemetryData.extendedBy(properties, measurements);
  extendedTelemetry.issuedTime = issuedTelemetryData.issuedTime;
  extendedTelemetry.measurements.timeToProduceMs = performance.now() - issuedTelemetryData.issuedTime;
  addDocumentTelemetry(extendedTelemetry, document);
  extendedTelemetry.extendWithRequestId(requestId);
  extendedTelemetry.measurements.confidence = ghostTextScoreConfidence(ctx, extendedTelemetry);
  extendedTelemetry.measurements.quantile = ghostTextScoreQuantile(ctx, extendedTelemetry);

  ghostTextLogger.debug(
    ctx,
    `Extended telemetry for ${choice.telemetryData.properties.headerRequestId} with retention confidence ${extendedTelemetry.measurements.confidence} (expected as good or better than about ${extendedTelemetry.measurements.quantile} of all suggestions)`
  );

  return extendedTelemetry;
}

function telemetryIssued(
  ctx: Context,
  document: CopilotTextDocument,
  requestContext: RequestContext,
  position: Position,
  prompt: Extract<ExtractedPrompt, { type: 'prompt' }>,
  baseTelemetryData: TelemetryWithExp,
  requestInfo: RequestInfo
): TelemetryWithExp {
  const properties: TelemetryProperties = { languageId: document.languageId };

  if (requestContext.requestForNextLine !== undefined) {
    properties.requestForNextLine = requestContext.requestForNextLine.toString();
  }

  const telemetryData = baseTelemetryData.extendedBy(properties);
  addDocumentTelemetry(telemetryData, document);
  const repoInfo = requestContext.repoInfo;
  telemetryData.properties.gitRepoInformation =
    repoInfo === undefined ? 'unavailable' : repoInfo === 0 ? 'pending' : 'available';

  if (repoInfo !== undefined && repoInfo !== 0) {
    telemetryData.properties.gitRepoUrl = repoInfo.url;
    telemetryData.properties.gitRepoHost = repoInfo.hostname;
    telemetryData.properties.gitRepoOwner = repoInfo.owner;
    telemetryData.properties.gitRepoName = repoInfo.repo;
    telemetryData.properties.gitRepoPath = repoInfo.pathname;
  }

  telemetryData.properties.engineName = requestInfo.modelId;
  telemetryData.properties.engineChoiceSource = requestInfo.engineChoiceSource;
  telemetryData.properties.isMultiline = JSON.stringify(requestContext.multiline);
  telemetryData.properties.isCycling = JSON.stringify(requestContext.isCycling);
  const currentLine = document.lineAt(position.line);
  const lineBeforeCursor = document.getText(LocationFactory.range(currentLine.range.start, position));
  const restOfLine = document.getText(LocationFactory.range(position, currentLine.range.end));

  const typeFileHashCode = Array.from(prompt.neighborSource.entries()).map((typeFiles) => [
    typeFiles[0],
    typeFiles[1].map((f) => SHA256(f).toString()),
  ]);

  const extendedProperties: Record<string, string> = {
    beforeCursorWhitespace: JSON.stringify(lineBeforeCursor.trim() === ''),
    afterCursorWhitespace: JSON.stringify(restOfLine.trim() === ''),
    promptChoices: JSON.stringify(prompt.promptChoices, (key, value) =>
      value instanceof Map ? Array.from(value.entries()).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}) : value
    ),
    promptBackground: JSON.stringify(prompt.promptBackground, (key, value) =>
      value instanceof Map ? Array.from(value.values()) : value
    ),
    neighborSource: JSON.stringify(typeFileHashCode),
    blockMode: requestContext.blockMode,
  };

  const extendedMeasurements = {
    ...telemetrizePromptLength(prompt.prompt),
    promptEndPos: document.offsetAt(position),
    promptComputeTimeMs: prompt.computeTimeMs,
  };

  if (prompt.metadata) {
    extendedProperties.promptMetadata = JSON.stringify(prompt.metadata);
  }

  const telemetryDataToSend = telemetryData.extendedBy(extendedProperties, extendedMeasurements);

  telemetryDataToSend.measurements.contextualFilterScore = contextualFilterScore(
    ctx,
    telemetryDataToSend,
    prompt.prompt
  );

  telemetry(ctx, 'ghostText.issued', telemetryDataToSend);
  return telemetryData;
}

function addDocumentTelemetry(telemetry: TelemetryWithExp, document: CopilotTextDocument): void {
  telemetry.measurements.documentLength = document.getText().length;
  telemetry.measurements.documentLineCount = document.lineCount;
}

function telemetryPerformance(
  ctx: Context,
  performanceKind: string,
  choice: APIChoice,
  requestStart: number,
  processingTimeMs: number
) {
  const requestTimeMs = Date.now() - requestStart;
  const deltaMs = requestTimeMs - processingTimeMs;

  const telemetryData = choice.telemetryData.extendedBy(
    {},
    {
      completionCharLen: choice.completionText.length,
      requestTimeMs,
      processingTimeMs,
      deltaMs,
      meanLogProb: choice.meanLogProb || NaN,
      meanAlternativeLogProb: choice.meanAlternativeLogProb || NaN,
    }
  );

  telemetryData.extendWithRequestId(choice.requestId);
  telemetry(ctx, `ghostText.${performanceKind}`, telemetryData);
}

const ghostTextLogger = new Logger('ghostText');
const ghostTextDebouncer = new Debouncer();
const defaultOptions: GhostTextOptions = {
  isCycling: false,
  promptOnly: false,
  ifInserted: undefined,
  isSpeculative: false,
};

class ForceMultiLine {
  static default = new ForceMultiLine();
  constructor(public requestMultilineOverride = false) {}
}

const MAX_COMPLETION_CACHE_PREFIX_BACKTRACK = 50;

export { ForceMultiLine, getGhostText };

export type { Result, GhostTextResult };
