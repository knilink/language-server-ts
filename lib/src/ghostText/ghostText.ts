import { SHA256 } from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';
import { Position } from 'vscode-languageserver-types';

import type { LanguageId, Prompt } from '../../../prompt/src/types';
import type { BlockMode, RepoInfo, TelemetryProperties, TelemetryMeasurements, Completion } from '../types';
import { CompletionResultType } from '../types';

import { type Context } from '../context';
import { SSEProcessor } from '../openai/stream';

import { CancellationToken } from '../../../agent/src/cancellation';
import { APIChoice, getTemperatureForSamples } from '../openai/openai';
import { shouldDoServerTrimming, shouldDoParsingTrimming, BlockModeConfig } from '../config';
import { telemetrizePromptLength, telemetry, TelemetryData, TelemetryWithExp } from '../telemetry';
import { OpenAIFetcher, extractEngineName } from '../openai/fetch';
import { mkBasicResultTelemetry, mkCanceledResultTelemetry } from './telemetry';
import { isAbortError } from '../networking';
import { UserErrorNotifier } from '../error/userErrorNotifier';
import { shouldFailForDebugPurposes, isRunningInTest } from '../testing/runtimeMode';
import { Features } from '../experiments/features';
import { LocationFactory, TextDocument } from '../textDocument';
import { parsingBlockFinished, contextIndentation, isEmptyBlockStart } from '../prompt/parseBlock';
import { extractPrompt, trimLastLine, type ExtractedPrompt } from '../prompt/prompt';
import { StatusReporter } from '../progress';
import { extractRepoInfoInBackground } from '../prompt/repository';
import { getEngineRequestInfo } from '../openai/config';
import { getDebounceLimit } from './debounce';
import { asyncIterableMapFilter, asyncIterableFromArray } from '../common/iterableHelpers';
import { postProcessChoice, checkSuffix } from '../suggestions/suggestions';
import { requestMultilineScore } from './multilineModel';
import { isSupportedLanguageId } from '../../../prompt/src/parse';
import { keyForPrompt } from '../common/cache';
import { CompletionsCache } from './completionsCache';
import { ghostTextScoreConfidence, ghostTextScoreQuantile } from '../suggestions/restraint';
import { contextualFilterScore } from './contextualFilter';
import { Logger, LogLevel } from '../logger';
import { Debouncer } from '../common/debounce';

import { ParamsType } from '../../../agent/src/methods/getCompletions';
type IfInserted = ParamsType['doc']['ifInserted'];

type RequestContext = {
  languageId: LanguageId;
  indentation?: { next?: number };
  blockMode: BlockMode;
  prompt: Prompt;
  multiline: boolean;
  multiLogitBias: boolean;
  isCycling: boolean;
  repoInfo?: RepoInfo | 0; // computeInBackgroundAndMemoize not finished when 0
  ourRequestId: string;
  engineURL: string;
  headers: Record<string, string>;
  delayMs: number;
  prefix: string;
};

type ProcessChoicesFunc<T> = (
  numGhostCompletions: number,
  requestStart: number,
  processingTime: number,
  choices: AsyncIterable<APIChoice>
) => Promise<CompletionResult<T>>;

const ghostTextLogger = new Logger(LogLevel.INFO, 'ghostText');

const ghostTextDebouncer = new Debouncer();

type CompletionResult<T> =
  | {
    type: 'failed';
    reason: string;
    telemetryData: TelemetryProperties;
  }
  | {
    type: 'canceled';
    reason: string;
    telemetryData: { cancelledNetworkRequest?: boolean; telemetryBlob: TelemetryData };
  }
  | {
    type: 'empty';
    reason: string;
    telemetryData: TelemetryProperties;
  }
  | {
    type: 'abortedBeforeIssued';
    reason: string;
  }
  | {
    type: 'success';
    // value: apiChoices, array
    value: T;
    telemetryData: TelemetryProperties;
    telemetryBlob: TelemetryData;
  };

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
};

type GhostTextResult = CompletionResult<[Result[], CompletionResultType]>;

class ForceMultiLine {
  constructor(public requestMultilineOverride = false) { }
}

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
  } else if (requestContext.multiLogitBias) {
    postOptions.logit_bias = { 50256: -100 };
  }

  const requestStart = Date.now();
  const newProperties: TelemetryProperties = {
    endpoint: 'completions',
    uiKind: 'ghostText',
    isCycling: JSON.stringify(requestContext.isCycling),
    temperature: JSON.stringify(temperature),
    n: JSON.stringify(numGhostCompletions),
    stop: JSON.stringify(postOptions.stop ?? 'unset'),
    logit_bias: JSON.stringify(postOptions.logit_bias ?? null),
  };
  const newMeasurements = telemetrizePromptLength(requestContext.prompt);

  Object.assign(baseTelemetryData.properties, newProperties);
  Object.assign(baseTelemetryData.measurements, newMeasurements);

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

    if (requestContext.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, requestContext.delayMs));
    }

    const res = await ctx
      .get(OpenAIFetcher)
      .fetchAndStreamCompletions(ctx, completionParams, baseTelemetryData, finishedCb, cancellationToken);

    if (res.type === 'failed') {
      return { type: 'failed', reason: res.reason, telemetryData: mkBasicResultTelemetry(baseTelemetryData) };
    } else if (res.type === 'canceled') {
      ghostTextLogger.debug(ctx, 'Cancelled after awaiting fetchCompletions');
      return { type: 'canceled', reason: res.reason, telemetryData: mkCanceledResultTelemetry(baseTelemetryData) };
    }
    return processChoices(numGhostCompletions, requestStart, res.getProcessingTime(), res.choices);
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

async function getCompletionsFromNetwork(
  ctx: Context,
  requestContext: RequestContext,
  baseTelemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken,
  finishedCb: SSEProcessor.FinishedCb
): Promise<CompletionResult<APIChoice>> {
  return genericGetCompletionsFromNetwork<APIChoice>(
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
    ): Promise<CompletionResult<APIChoice>> => {
      const choicesIterator = choicesStream[Symbol.asyncIterator]();
      const firstRes = await choicesIterator.next();

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
      const remainingChoices = numGhostCompletions - 1;
      ghostTextLogger.debug(ctx, `Awaited first result, id: ${firstChoice.choiceIndex}`);
      addToCache(ctx, requestContext, { multiline: requestContext.multiline, choices: [firstChoice] });
      const remainingPromises: Promise<IteratorResult<APIChoice>>[] = [];
      for (let index = 0; index < remainingChoices; index++) remainingPromises.push(choicesIterator.next());
      const cacheDone = Promise.all(remainingPromises).then(async (results) => {
        if (ctx.get(Features).fastCancellation(baseTelemetryData)) {
          choicesIterator.next();
        }
        ghostTextLogger.debug(ctx, `Awaited remaining results, number of results: ${results.length}`);
        const apiChoices: APIChoice[] = [];

        for (const innerChoice of results) {
          const redactedChoice = innerChoice.value;
          if (redactedChoice !== undefined) {
            ghostTextLogger.debug(ctx, `GhostText later completion: ${JSON.stringify(redactedChoice.completionText)}`);
          }
          if (redactedChoice.completionText.trimEnd()) {
            if (
              apiChoices.some((v) => v.completionText.trim() === redactedChoice.completionText.trim()) ||
              redactedChoice.completionText.trim() === firstChoice.completionText.trim()
            )
              continue;
            apiChoices.push(redactedChoice);
          }
        }
        if (apiChoices.length > 0) {
          appendToCache(ctx, requestContext, { multiline: requestContext.multiline, choices: apiChoices });
        }
      });
      if (isRunningInTest(ctx)) {
        await cacheDone;
      }
      return {
        type: 'success',
        value: makeGhostAPIChoice(firstRes.value, { forceSingleLine: false }),
        telemetryData: mkBasicResultTelemetry(baseTelemetryData),
        telemetryBlob: baseTelemetryData,
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
): Promise<CompletionResult<APIChoice[]>> {
  return genericGetCompletionsFromNetwork<APIChoice[]>(
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
    ): Promise<CompletionResult<APIChoice[]>> => {
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
        if (choice.completionText.trimEnd()) {
          const trimmedChoice = choice.completionText.trim();
          if (apiChoices.some((v) => v.completionText.trim() === trimmedChoice)) continue;
          apiChoices.push(choice);
        }
      }

      if (apiChoices.length > 0) {
        appendToCache(ctx, requestContext, { multiline: requestContext.multiline, choices: apiChoices });
        telemetryPerformance(ctx, 'cyclingPerformance', apiChoices[0], requestStart, processingTime);
      }
      return {
        type: 'success',
        value: apiChoices,
        telemetryData: mkBasicResultTelemetry(baseTelemetryData),
        telemetryBlob: baseTelemetryData,
      };
    }
  );
}

function makeGhostAPIChoice(choice: APIChoice, options: { forceSingleLine: boolean }): APIChoice {
  const ghostChoice = { ...choice };
  ghostChoice.completionText = choice.completionText.trimEnd();
  if (options.forceSingleLine) {
    ghostChoice.completionText = ghostChoice.completionText.split(`\n`)[0];
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
    return requestContext.isCycling ? Math.max(0, 3 - override) : override;
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
  document: TextDocument,
  position: Position,
  prompt: Extract<ExtractedPrompt, { type: 'prompt' }>,
  isCycling: boolean,
  inlineSuggestion: boolean,
  preIssuedTelemetryData: TelemetryWithExp,
  requestMultilineExploration = false,
  requestMultilineOnNewLine = true,
  requestMultiModel = true,
  requestMultiModelThreshold = 0.5
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
        finishedCb: async () => undefined,
      };
    case 'parsing':
    case 'parsingandserver':
    default: {
      if (
        await shouldRequestMultiline(
          ctx,
          document,
          position,
          inlineSuggestion,
          preIssuedTelemetryData,
          prompt,
          requestMultilineExploration,
          requestMultilineOnNewLine,
          requestMultiModel,
          requestMultiModelThreshold
        )
      ) {
        let adjustedPosition: Position;
        if (prompt.trailingWs.length > 0 && !prompt.prompt.prefix.endsWith(prompt.trailingWs)) {
          adjustedPosition = LocationFactory.position(
            position.line,
            Math.max(position.character - prompt.trailingWs.length, 0)
          );
        } else {
          adjustedPosition = position;
        }
        return {
          blockMode: blockMode,
          requestMultiline: true,
          isCyclingRequest: false,
          finishedCb: parsingBlockFinished(ctx, document, adjustedPosition),
        };
      }
      return {
        blockMode: blockMode,
        requestMultiline: false,
        isCyclingRequest: isCycling,
        finishedCb: async () => undefined,
      };
    }
  }
}

async function getGhostText(
  ctx: Context,
  document: TextDocument,
  position: Position,
  isCycling: boolean,
  preIssuedTelemetryData: TelemetryData,
  cancellationToken: CancellationToken,
  ifInserted: IfInserted
): Promise<GhostTextResult> {
  const ourRequestId = uuidv4();
  preIssuedTelemetryData = preIssuedTelemetryData.extendedBy({ headerRequestId: ourRequestId });

  const documentSource = document.getText();
  const positionOffset = document.offsetAt(position);
  const actualSuffix = documentSource.substring(positionOffset);
  const features = ctx.get(Features);

  const preIssuedTelemetryDataWithExp = await features.updateExPValuesAndAssignments(
    ctx,
    { uri: document.vscodeUri, languageId: document.languageId },
    preIssuedTelemetryData
  );

  const prompt = await extractPrompt(ctx, document, position, preIssuedTelemetryDataWithExp, ifInserted);

  if (prompt.type === 'copilotNotAvailable') {
    ghostTextLogger.debug(ctx, 'Copilot not available, due to content exclusion');
    return { type: 'abortedBeforeIssued', reason: 'Copilot not available due to content exclusion' };
  }

  if (prompt.type === 'contextTooShort') {
    ghostTextLogger.debug(ctx, 'Breaking, not enough context');
    return { type: 'abortedBeforeIssued', reason: 'Not enough context' };
  }

  if (cancellationToken?.isCancellationRequested) {
    ghostTextLogger.debug(ctx, 'Cancelled after extractPrompt');
    return { type: 'abortedBeforeIssued', reason: 'Cancelled after extractPrompt' };
  }

  const inlineSuggestion = isInlineSuggestion(document, position);
  if (inlineSuggestion === undefined) {
    ghostTextLogger.debug(ctx, 'Breaking, invalid middle of the line');
    return { type: 'abortedBeforeIssued', reason: 'Invalid middle of the line' };
  }

  const statusBarItem = ctx.get(StatusReporter);
  const ghostTextStrategy = await getGhostTextStrategy(
    ctx,
    document,
    position,
    prompt,
    isCycling,
    inlineSuggestion,
    preIssuedTelemetryDataWithExp
  );

  if (cancellationToken?.isCancellationRequested) {
    ghostTextLogger.debug(ctx, 'Cancelled after requestMultiline');
    return { type: 'abortedBeforeIssued', reason: 'Cancelled after requestMultiline' };
  }

  const [prefix] = trimLastLine(document.getText(LocationFactory.range(LocationFactory.position(0, 0), position)));
  let choices = getLocalInlineSuggestion(ctx, prefix, prompt.prompt, ghostTextStrategy.requestMultiline);
  const repoInfo = extractRepoInfoInBackground(ctx, document.vscodeUri);
  const engineInfo = await getEngineRequestInfo(ctx, document.vscodeUri, preIssuedTelemetryDataWithExp);
  const delayMs = features.beforeRequestWaitMs(preIssuedTelemetryDataWithExp);
  const multiLogitBias = features.multiLogitBias(preIssuedTelemetryDataWithExp);

  const requestContext: RequestContext = {
    blockMode: ghostTextStrategy.blockMode,
    languageId: document.languageId,
    repoInfo,
    engineURL: engineInfo.url,
    ourRequestId,
    prefix,
    prompt: prompt.prompt,
    multiline: ghostTextStrategy.requestMultiline,
    indentation: contextIndentation(document, position),
    isCycling,
    delayMs,
    multiLogitBias,
    headers: engineInfo.headers,
  };

  const debouncePredict = features.debouncePredict(preIssuedTelemetryDataWithExp);
  const contextualFilterEnable = features.contextualFilterEnable(preIssuedTelemetryDataWithExp);
  const contextualFilterAcceptThreshold = features.contextualFilterAcceptThreshold(preIssuedTelemetryDataWithExp);
  const contextualFilterEnableTree = features.contextualFilterEnableTree(preIssuedTelemetryDataWithExp);
  const contextualFilterExplorationTraffic = features.contextualFilterExplorationTraffic(preIssuedTelemetryDataWithExp);

  const telemetryData = telemetryIssued(
    ctx,
    document,
    requestContext,
    position,
    prompt,
    preIssuedTelemetryDataWithExp,
    debouncePredict || contextualFilterEnable,
    contextualFilterEnableTree
  );

  if (
    ((ghostTextStrategy.isCyclingRequest && choices?.[0]?.length) ?? 0 > 1) ||
    (!ghostTextStrategy.isCyclingRequest && choices)
  ) {
    ghostTextLogger.debug(ctx, 'Found inline suggestions locally');
  } else {
    const statusBarItem = ctx.get(StatusReporter);
    if (statusBarItem) {
      statusBarItem.setProgress();
    }

    if (ghostTextStrategy.isCyclingRequest) {
      const networkChoices = await getAllCompletionsFromNetwork(
        ctx,
        requestContext,
        telemetryData,
        cancellationToken,
        ghostTextStrategy.finishedCb
      );

      if (networkChoices.type === 'success') {
        const resultChoices = choices?.[0] ?? [];
        for (const c of networkChoices.value) {
          if (resultChoices.every((v) => v.completionText.trim() !== c.completionText.trim())) {
            resultChoices.push(c);
          }
        }
        choices = [resultChoices, CompletionResultType.WithCompletion];
      } else if (!choices) {
        statusBarItem?.removeProgress();
        return networkChoices;
      }
    } else {
      const debounceLimit = await getDebounceLimit(ctx, telemetryData);
      try {
        await ghostTextDebouncer.debounce(debounceLimit);
      } catch (error) {
        return { type: 'canceled', reason: 'by debouncer', telemetryData: mkCanceledResultTelemetry(telemetryData) };
      }
      if (cancellationToken?.isCancellationRequested) {
        ghostTextLogger.debug(ctx, 'Cancelled during debounce');
        return { type: 'canceled', reason: 'during debounce', telemetryData: mkCanceledResultTelemetry(telemetryData) };
      }

      if (
        contextualFilterEnable &&
        telemetryData.measurements.contextualFilterScore &&
        telemetryData.measurements.contextualFilterScore < contextualFilterAcceptThreshold / 100 &&
        Math.random() < 1 - contextualFilterExplorationTraffic / 100
      ) {
        ghostTextLogger.debug(ctx, 'Cancelled by contextual filter');
        return {
          type: 'canceled',
          reason: 'contextualFilterScore below threshold',
          telemetryData: mkCanceledResultTelemetry(telemetryData),
        };
      }

      const c = await getCompletionsFromNetwork(
        ctx,
        requestContext,
        telemetryData,
        cancellationToken,
        ghostTextStrategy.finishedCb
      );

      if (c.type !== 'success') {
        statusBarItem?.removeProgress();
        return c;
      }

      choices = [[c.value], CompletionResultType.New]; //MARK
    }
    statusBarItem.removeProgress();
  }
  if (!choices) {
    return {
      type: 'failed',
      reason: 'internal error: choices should be defined after network call',
      telemetryData: mkBasicResultTelemetry(telemetryData),
    };
  }

  const [choicesArray, resultType] = choices;
  const postProcessedChoices = asyncIterableMapFilter(asyncIterableFromArray(choicesArray), async (choice) =>
    postProcessChoice(ctx, document, position, choice, inlineSuggestion, ghostTextLogger, prompt.prompt, actualSuffix)
  );

  const results: Result[] = [];
  for await (const choice of postProcessedChoices) {
    if (cancellationToken?.isCancellationRequested) {
      ghostTextLogger.debug(ctx, 'Cancelled after post processing completions');
      return {
        type: 'canceled',
        reason: 'after post processing completions',
        telemetryData: mkCanceledResultTelemetry(telemetryData),
      };
    }
    const choiceTelemetryData = telemetryWithAddData(ctx, choice);
    const suffixCoverage = inlineSuggestion ? checkSuffix(document, position, choice) : 0;
    results.push({
      completion: adjustLeadingWhitespace(choice.choiceIndex, choice.completionText, prompt.trailingWs),
      telemetry: choiceTelemetryData,
      isMiddleOfTheLine: inlineSuggestion,
      suffixCoverage,
    });
  }

  return {
    type: 'success',
    value: [results, resultType],
    telemetryData: mkBasicResultTelemetry(telemetryData),
    telemetryBlob: telemetryData,
  };
}

function getLocalInlineSuggestion(
  ctx: Context,
  prefix: string,
  prompt: Prompt,
  requestMultiline: boolean
): [APIChoice[], CompletionResultType] | undefined {
  let choicesTyping = getCompletionsForUserTyping(ctx, prefix, prompt, requestMultiline);
  if (choicesTyping && choicesTyping.length > 0) return [choicesTyping, CompletionResultType.UserTyping];
  let choicesCache = getCompletionsFromCache(ctx, prefix, prompt, requestMultiline);
  if (choicesCache && choicesCache.length > 0) return [choicesCache, CompletionResultType.Cached];
}

function isInlineSuggestion(document: TextDocument, position: Position): boolean | undefined {
  const isMiddleOfLine = isMiddleOfTheLine(position, document);
  const isValidMiddleOfLine = isValidMiddleOfTheLinePosition(position, document);
  return isMiddleOfLine && !isValidMiddleOfLine ? undefined : isMiddleOfLine && isValidMiddleOfLine;
}

function isMiddleOfTheLine(selectionPosition: Position, doc: TextDocument) {
  return doc.lineAt(selectionPosition).text.substring(selectionPosition.character).trim().length !== 0;
}

function isValidMiddleOfTheLinePosition(selectionPosition: Position, doc: TextDocument) {
  let endOfLine = doc.lineAt(selectionPosition).text.substring(selectionPosition.character).trim();
  return /^\s*[)}\]"'`]*\s*[:{;,]?\s*$/.test(endOfLine);
}

function isNewLine(selectionPosition: Position, doc: TextDocument) {
  return doc.lineAt(selectionPosition).text.trim().length === 0;
}

function exploreMultilineRandom() {
  return Math.random() > 0.5;
}

async function requestMultilineExperiment(
  requestMultilineExploration: boolean,
  requestMultiModel: boolean,
  requestMultiModelThreshold: number,
  document: TextDocument,
  prompt: Extract<ExtractedPrompt, { type: 'prompt' }>
) {
  if (requestMultilineExploration) {
    return exploreMultilineRandom();
  } else if (requestMultiModel && ['javascript', 'javascriptreact', 'python'].includes(document.languageId)) {
    return requestMultilineScore(prompt.prompt, document.languageId) > requestMultiModelThreshold;
  }
  return false;
}

async function shouldRequestMultiline(
  ctx: Context,
  document: TextDocument,
  position: Position,
  inlineSuggestion: boolean,
  preIssuedTelemetryData: TelemetryWithExp,
  prompt: Extract<ExtractedPrompt, { type: 'prompt' }>,
  requestMultilineExploration: boolean,
  requestMultilineOnNewLine: boolean,
  requestMultiModel: boolean,
  requestMultiModelThreshold: number
): Promise<boolean> {
  if (ctx.get(ForceMultiLine).requestMultilineOverride) return true;

  if (requestMultilineExploration) {
    const isEmptyBlockStartDocumentPosition = await isEmptyBlockStart(document, position);
    const isEmptyBlockStartDocumentPositionRangeEnd = await isEmptyBlockStart(
      document,
      document.lineAt(position).range.end
    );

    preIssuedTelemetryData.properties.isEmptyBlockStartDocumentPosition = isEmptyBlockStartDocumentPosition.toString();
    preIssuedTelemetryData.properties.isEmptyBlockStartDocumentPositionRangeEnd =
      isEmptyBlockStartDocumentPositionRangeEnd.toString();
    preIssuedTelemetryData.properties.inlineSuggestion = inlineSuggestion.toString();
    preIssuedTelemetryData.measurements.documentLineCount = document.lineCount;
    preIssuedTelemetryData.measurements.positionLine = position.line;
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
  } else {
    if (
      requestMultilineOnNewLine &&
      ['typescript', 'typescriptreact'].includes(document.languageId) &&
      isNewLine(position, document)
    ) {
      return true;
    }

    let requestMultiline = false;

    if (!inlineSuggestion && isSupportedLanguageId(document.languageId)) {
      requestMultiline = await isEmptyBlockStart(document, position);
    } else if (inlineSuggestion && isSupportedLanguageId(document.languageId)) {
      requestMultiline =
        (await isEmptyBlockStart(document, position)) ||
        (await isEmptyBlockStart(document, document.lineAt(position).range.end));
    }

    if (!requestMultiline) {
      requestMultiline = await requestMultilineExperiment(
        requestMultilineExploration,
        requestMultiModel,
        requestMultiModelThreshold,
        document,
        prompt
      );
    }

    return requestMultiline;
  }

  return false;
}

let lastPrefix: string;
let lastSuffix: string;
let lastPromptHash: string;

function recordLastSuccessfulCompletionContext(prefix: string, suffix: string, promptHash: string) {
  lastPrefix = prefix;
  lastSuffix = suffix;
  lastPromptHash = promptHash;
}

function addToCache(
  ctx: Context,
  requestContext: RequestContext,
  contents: { multiline: boolean; choices: APIChoice[] }
) {
  let promptHash = keyForPrompt(requestContext.prompt);
  recordLastSuccessfulCompletionContext(requestContext.prefix, requestContext.prompt.suffix, promptHash);
  ctx.get(CompletionsCache).set(promptHash, contents);
  ghostTextLogger.debug(
    ctx,
    `Cached ghost text for key: ${promptHash}, multiline: ${contents.multiline}, number of suggestions: ${contents.choices.length}`
  );
}

function appendToCache(
  ctx: Context,
  requestContext: RequestContext,
  newContents: { multiline: boolean; choices: APIChoice[] }
): void {
  const promptHash = keyForPrompt(requestContext.prompt);
  const existing = ctx.get(CompletionsCache).get(promptHash);

  if (existing && existing.multiline === newContents.multiline) {
    ctx.get(CompletionsCache).set(promptHash, {
      multiline: existing.multiline,
      choices: existing.choices.concat(newContents.choices),
    });
  } else {
    ctx.get(CompletionsCache).set(promptHash, newContents);
  }

  ghostTextLogger.debug(
    ctx,
    `Appended cached ghost text for key: ${promptHash}, multiline: ${newContents.multiline}, number of suggestions: ${newContents.choices.length}`
  );
}

function getCachedChoices(ctx: Context, promptHash: string, multiline: boolean): APIChoice[] | undefined {
  const contents = ctx.get(CompletionsCache).get(promptHash);
  if (contents && !(multiline && !contents.multiline)) return contents.choices;
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
    } else {
      const textLeftWs = text.substring(0, text.length - text.trimStart().length);
      if (ws.startsWith(textLeftWs)) {
        return {
          completionIndex: index,
          completionText: text,
          displayText: text.trimStart(),
          displayNeedsWsOffset: true,
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
  } else {
    return {
      completionIndex: index,
      completionText: text,
      displayText: text,
      displayNeedsWsOffset: false,
    };
  }
}

function getCompletionsForUserTyping(
  ctx: Context,
  prefix: string,
  prompt: Prompt,
  multiline: boolean
): APIChoice[] | undefined {
  const prefixMatches = lastPrefix !== undefined ? prefix.startsWith(lastPrefix) : false;
  const suffixMatches = lastSuffix !== undefined ? prompt.suffix === lastSuffix : false;

  if (!lastPrefix || !lastPromptHash || !prefixMatches || !suffixMatches) return;

  const lastCachedCompletion = getCachedChoices(ctx, lastPromptHash, multiline);
  if (!lastCachedCompletion) return;

  const remainingPrefix = prefix.substring(lastPrefix.length);
  ghostTextLogger.debug(ctx, `Getting completions for user-typing flow - remaining prefix: ${remainingPrefix}`);

  let completionsToReturn: APIChoice[] = [];
  for (const element of lastCachedCompletion) {
    const completionToReturn = makeGhostAPIChoice(element, { forceSingleLine: false });
    if (completionToReturn.completionText.startsWith(remainingPrefix)) {
      completionToReturn.completionText = completionToReturn.completionText.substring(remainingPrefix.length);
      completionsToReturn.push(completionToReturn);
    }
  }

  return completionsToReturn;
}

function getCompletionsFromCache(
  ctx: Context,
  prefix: string,
  prompt: Prompt,
  multiline: boolean
): APIChoice[] | undefined {
  const promptHash = keyForPrompt(prompt);
  ghostTextLogger.debug(ctx, `Trying to get completions from cache for key: ${promptHash}`);
  const cachedChoice = getCachedChoices(ctx, promptHash, multiline);

  if (cachedChoice) {
    ghostTextLogger.debug(ctx, `Got completions from cache for key: ${promptHash}`);
    const completionsToReturn: APIChoice[] = [];

    for (const element of cachedChoice) {
      const completionToReturn = makeGhostAPIChoice(element, { forceSingleLine: !multiline });
      completionsToReturn.push(completionToReturn);
    }

    const result = completionsToReturn.filter((e) => e.completionText);
    if (result.length > 0) {
      recordLastSuccessfulCompletionContext(prefix, prompt.suffix, promptHash);
    }
    return result;
  }
}

// APIChoice TelemetryWithExp ../../../agent/src/methods/getCompletions.ts
function telemetryWithAddData(ctx: Context, choice: APIChoice): TelemetryWithExp {
  const requestId = choice.requestId;
  const properties: TelemetryProperties = { choiceIndex: choice.choiceIndex.toString() };
  const measurements: TelemetryMeasurements = {
    numTokens: choice.numTokens,
    compCharLen: choice.completionText.length,
    numLines: choice.completionText.split('\n').length,
  };

  if (choice.meanLogProb) measurements.meanLogProb = choice.meanLogProb;
  if (choice.meanAlternativeLogProb) measurements.meanAlternativeLogProb = choice.meanAlternativeLogProb;

  const extendedTelemetry = choice.telemetryData.extendedBy(properties, measurements);
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
  document: TextDocument,
  requestContext: RequestContext,
  position: Position,
  prompt: Extract<ExtractedPrompt, { type: 'prompt' }>,
  baseTelemetryData: TelemetryWithExp,
  computeContextualFilterScore: boolean,
  contextualFilterEnableTree: boolean
): TelemetryWithExp {
  const currentLine = document.lineAt(position.line);
  const lineBeforeCursor = document.getText(LocationFactory.range(currentLine.range.start, position));
  const restOfLine = document.getText(LocationFactory.range(position, currentLine.range.end));

  const properties: TelemetryProperties = {
    languageId: document.languageId,
    beforeCursorWhitespace: JSON.stringify(lineBeforeCursor.trim() === ''),
    afterCursorWhitespace: JSON.stringify(restOfLine.trim() === ''),
  };

  const measurements: TelemetryMeasurements = {
    ...telemetrizePromptLength(prompt.prompt),
    promptEndPos: document.offsetAt(position),
    documentLength: document.getText().length,
    delayMs: requestContext.delayMs,
  };

  let telemetryData = baseTelemetryData.extendedBy(properties, measurements);

  telemetryData.properties.promptChoices = JSON.stringify(prompt.promptChoices, (key, value) =>
    value instanceof Map ? Array.from(value.entries()).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}) : value
  );

  telemetryData.properties.promptBackground = JSON.stringify(prompt.promptBackground, (key, value) =>
    value instanceof Map ? Array.from(value.values()) : value
  );

  const typeFileHashCode = Array.from(prompt.neighborSource.entries()).map(([typeFilesKey, files]) => [
    typeFilesKey,
    files.map((f) => SHA256(f).toString()),
  ]);

  telemetryData.properties.neighborSource = JSON.stringify(typeFileHashCode);
  telemetryData.measurements.promptComputeTimeMs = prompt.computeTimeMs;

  if (computeContextualFilterScore) {
    telemetryData.measurements.contextualFilterScore = contextualFilterScore(
      ctx,
      telemetryData,
      prompt.prompt,
      contextualFilterEnableTree
    );
  }

  const repoInfo = requestContext.repoInfo;
  telemetryData.properties.gitRepoInformation =
    repoInfo === undefined ? 'unavailable' : repoInfo === 0 ? 'pending' : 'available';

  if (repoInfo) {
    telemetryData.properties.gitRepoUrl = repoInfo.url;
    telemetryData.properties.gitRepoHost = repoInfo.hostname;
    telemetryData.properties.gitRepoOwner = repoInfo.owner;
    telemetryData.properties.gitRepoName = repoInfo.repo;
    telemetryData.properties.gitRepoPath = repoInfo.pathname;
  }

  telemetryData.properties.engineName = extractEngineName(ctx, requestContext.engineURL);
  telemetryData.properties.isMultiline = JSON.stringify(requestContext.multiline);
  telemetryData.properties.blockMode = requestContext.blockMode;
  telemetryData.properties.isCycling = JSON.stringify(requestContext.isCycling);

  telemetry(ctx, 'ghostText.issued', telemetryData);
  return telemetryData;
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
      requestTimeMs: requestTimeMs,
      processingTimeMs: processingTimeMs,
      deltaMs: deltaMs,
      meanLogProb: choice.meanLogProb || NaN,
      meanAlternativeLogProb: choice.meanAlternativeLogProb || NaN,
      numTokens: choice.numTokens,
    }
  );
  telemetryData.extendWithRequestId(choice.requestId);
  telemetry(ctx, `ghostText.${performanceKind}`, telemetryData);
}

const forceMultiLine = new ForceMultiLine();

export { ForceMultiLine, CompletionResult, Result, getGhostText, GhostTextResult, forceMultiLine };
