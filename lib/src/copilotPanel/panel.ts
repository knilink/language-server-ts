import type { Position } from 'vscode-languageserver-types';
import type { Context } from '../context.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { APIChoice } from '../openai/openai.ts';
import type { TelemetryWithExp } from '../telemetry.ts';
import type { CopilotTextDocument } from '../textDocument.ts';

import { completionTypeToString } from './common.ts';
import { asyncIterableMapFilter } from '../common/iterableHelpers.ts';
import { BlockModeConfig } from '../config.ts';
import { Features } from '../experiments/features.ts';
import { Logger } from '../logger.ts';
import { getEngineRequestInfo } from '../openai/config.ts';
import { OpenAIFetcher } from '../openai/fetch.ts';
import { cleanupIndentChoices } from '../openai/openai.ts';
import { StatusReporter } from '../progress.ts';
import { contextIndentation, getNodeStart, parsingBlockFinished } from '../prompt/parseBlock.ts';
import { promptLibProxy } from '../prompt/promptLibProxy.ts';
import { extractPrompt, trimLastLine } from '../prompt/prompt.ts';
import { extractRepoInfoInBackground } from '../prompt/repository.ts';
import { postProcessChoiceInContext } from '../suggestions/suggestions.ts';
import { TelemetryData, telemetrizePromptLength, telemetry } from '../telemetry.ts';
import { LocationFactory } from '../textDocument.ts';
import { v4 as uuidv4 } from 'uuid';
import { SSEProcessor } from '../openai/stream.ts';

type Solution = unknown;

type SolutionsStream =
  | { status: 'Solution'; solution: Solution; next: Promise<SolutionsStream> }
  | { status: 'FinishedNormally' }
  | { status: 'FinishedWithError'; error: string };

interface ISolutionHandler {
  onSolution(solution: Solution): Promise<void>;
  onFinishedNormally(): Promise<void>;
  onFinishedWithError(error: string): Promise<void>;
}

const solutionsLogger = new Logger('solutions');

async function* trimChoices(choices: AsyncIterable<APIChoice>): AsyncGenerator<APIChoice> {
  for await (let choice of choices) {
    const choiceCopy = { ...choice };
    choiceCopy.completionText = choiceCopy.completionText?.trimEnd();
    yield choiceCopy;
  }
}

function normalizeCompletionText(text: string): string {
  return text.replace(/\s+/g, '');
}

async function launchSolutions(ctx: Context, solutionManager: SolutionManager): Promise<SolutionsStream> {
  const position = solutionManager.completionContext.position;
  const indentation = solutionManager.completionContext.indentation;
  const document = solutionManager.textDocument;
  const repoInfo = extractRepoInfoInBackground(ctx, document.uri);
  const ourRequestId = uuidv4();
  const tempTelemetry = TelemetryData.createAndMarkAsIssued(
    {
      headerRequestId: ourRequestId,
      languageId: document.languageId,
      source: completionTypeToString(solutionManager.completionContext.completionType),
    },
    {}
  );

  solutionManager.savedTelemetryData = await ctx
    .get(Features)
    .updateExPValuesAndAssignments({ uri: document.uri, languageId: document.languageId }, tempTelemetry);

  const promptResponse = await extractPrompt(ctx, document, position, solutionManager.savedTelemetryData);
  if (promptResponse.type === 'copilotContentExclusion') {
    return { status: 'FinishedNormally' };
  }
  if (promptResponse.type === 'contextTooShort') {
    return { status: 'FinishedWithError', error: 'Context too short' };
  }
  if (promptResponse.type === 'promptCancelled') {
    return { status: 'FinishedWithError', error: 'Prompt cancelled' };
  }
  if (promptResponse.type === 'promptError') {
    return { status: 'FinishedWithError', error: 'Prompt error' };
  }

  const { prompt, trailingWs } = promptResponse;

  if (trailingWs.length > 0) {
    solutionManager.startPosition = LocationFactory.position(
      solutionManager.startPosition.line,
      solutionManager.startPosition.character - trailingWs.length
    );
  }

  const cancellationToken = solutionManager.cancellationToken;
  solutionManager.savedTelemetryData = solutionManager.savedTelemetryData.extendedBy(
    {},
    {
      ...telemetrizePromptLength(prompt),
      solutionCount: solutionManager.solutionCountTarget,
      promptEndPos: document.offsetAt(position),
    }
  );

  solutionsLogger.debug(ctx, 'prompt:', prompt);
  telemetry(ctx, 'solution.requested', solutionManager.savedTelemetryData);

  const blockMode = await ctx
    .get(BlockModeConfig)
    .forLanguage(ctx, document.languageId, solutionManager.savedTelemetryData);
  const isSupportedLanguage = promptLibProxy.isSupportedLanguageId(document.languageId);
  const contextIndent = contextIndentation(document, position);
  const postOptions: OpenAIFetcher.CompletionParams['postOptions'] = {
    stream: true,
    extra: {
      language: document.languageId,
      next_indent: contextIndent.next ?? 0,
      prompt_tokens: prompt.prefixTokens ?? 0,
      suffix_tokens: prompt.suffixTokens ?? 0,
    },
  };

  if (blockMode === 'parsing' && !isSupportedLanguage) {
    postOptions.stop = [`\n\n`, `\r\n\r\n`];
  }

  const engineInfo = await getEngineRequestInfo(ctx, solutionManager.savedTelemetryData);
  const completionParams: OpenAIFetcher.CompletionParams = {
    prompt,
    languageId: document.languageId,
    repoInfo,
    ourRequestId,
    engineUrl: engineInfo.url,
    count: solutionManager.solutionCountTarget,
    uiKind: 'synthesize',
    postOptions,
    requestLogProbs: true,
    headers: engineInfo.headers,
  };

  let finishedCb: SSEProcessor.FinishedCb;

  switch (blockMode) {
    case 'server':
      finishedCb = async () => undefined;
      postOptions.extra!.force_indent = contextIndent.prev ?? -1;
      postOptions.extra!.trim_by_indentation = true;
      break;
    case 'parsingandserver':
      finishedCb = isSupportedLanguage
        ? parsingBlockFinished(ctx, document, solutionManager.startPosition)
        : async () => undefined;
      postOptions.extra!.force_indent = contextIndent.prev ?? -1;
      postOptions.extra!.trim_by_indentation = true;
      break;
    case 'parsing':
    default:
      finishedCb = isSupportedLanguage
        ? parsingBlockFinished(ctx, document, solutionManager.startPosition)
        : async () => undefined;
  }

  const telemetryData = solutionManager.savedTelemetryData;
  const res = await ctx
    .get(OpenAIFetcher)
    .fetchAndStreamCompletions(ctx, completionParams, telemetryData.extendedBy(), finishedCb, cancellationToken);

  if (res.type === 'failed' || res.type === 'canceled') {
    return { status: 'FinishedWithError', error: `${res.type}: ${res.reason}` };
  }

  let choices = res.choices;
  choices = trimChoices(choices);

  if (indentation !== null) {
    choices = cleanupIndentChoices(choices, indentation);
  }

  choices = asyncIterableMapFilter(choices, async (choice: APIChoice) =>
    postProcessChoiceInContext(ctx, document, position, choice, false, solutionsLogger)
  );

  const solutions = asyncIterableMapFilter(choices, async (apiChoice: APIChoice) => {
    let display = apiChoice.completionText;
    solutionsLogger.info(ctx, `Open Copilot completion: [${apiChoice.completionText}]`);
    const displayStartPos =
      (await getNodeStart(ctx, document, position, apiChoice.completionText)) ??
      LocationFactory.position(position.line, 0);
    const [displayBefore] = trimLastLine(document.getText(LocationFactory.range(displayStartPos, position)));

    display = displayBefore + display;

    let completionText = apiChoice.completionText;
    if (trailingWs.length > 0 && completionText.startsWith(trailingWs)) {
      completionText = completionText.substring(trailingWs.length);
    }

    const meanLogProb = apiChoice.meanLogProb;
    const meanProb = meanLogProb !== undefined ? Math.exp(meanLogProb) : 0;
    const solutionTelemetryData = telemetryData.extendedBy({ choiceIndex: apiChoice.choiceIndex.toString() });

    return {
      completionText,
      insertText: display,
      range: LocationFactory.range(displayStartPos, position),
      meanProb,
      meanLogProb: meanLogProb || 0,
      requestId: apiChoice.requestId,
      choiceIndex: apiChoice.choiceIndex,
      telemetryData: solutionTelemetryData,
      copilotAnnotations: apiChoice.copilotAnnotations,
    };
  });

  return generateSolutionsStream(cancellationToken, solutions[Symbol.asyncIterator]());
}

async function reportSolutions(
  nextSolutionPromise: Promise<SolutionsStream>,
  solutionHandler: ISolutionHandler
): Promise<void> {
  const nextSolution = await nextSolutionPromise;
  switch (nextSolution.status) {
    case 'Solution':
      await solutionHandler.onSolution(nextSolution.solution);
      await reportSolutions(nextSolution.next, solutionHandler);
      break;
    case 'FinishedNormally':
      await solutionHandler.onFinishedNormally();
      break;
    case 'FinishedWithError':
      await solutionHandler.onFinishedWithError(nextSolution.error);
      break;
  }
}

async function runSolutions(
  ctx: Context,
  solutionManager: SolutionManager,
  solutionHandler: ISolutionHandler
): Promise<void> {
  return ctx.get(StatusReporter).withProgress(async () => {
    const nextSolution = launchSolutions(ctx, solutionManager);
    return await reportSolutions(nextSolution, solutionHandler);
  });
}

async function generateSolutionsStream(
  cancellationToken: CancellationToken,
  solutions: AsyncIterator<Solution>
): Promise<SolutionsStream> {
  if (cancellationToken.isCancellationRequested) {
    return { status: 'FinishedWithError', error: 'Cancelled' };
  }
  const nextResult = await solutions.next();
  return nextResult.done === true
    ? { status: 'FinishedNormally' }
    : { status: 'Solution', solution: nextResult.value, next: generateSolutionsStream(cancellationToken, solutions) };
}

class SolutionManager {
  _savedTelemetryData: TelemetryWithExp | undefined;
  constructor(
    public textDocument: CopilotTextDocument,
    public startPosition: Position,
    public completionContext: any,
    public cancellationToken: CancellationToken,
    public solutionCountTarget: number
  ) {}

  get savedTelemetryData(): TelemetryWithExp | undefined {
    return this._savedTelemetryData;
  }

  set savedTelemetryData(data: TelemetryWithExp) {
    this._savedTelemetryData = data;
  }
}

export { solutionsLogger, SolutionManager, normalizeCompletionText, runSolutions };
