import { type URI } from 'vscode-uri';
import type { Prompt } from '../../prompt/src/types.ts';

import { Context } from './context.ts';
import { TextDocumentManager } from './textDocumentManager.ts';
import { extractPrompt } from './prompt/prompt.ts';
import { contextIndentationFromText, indentationBlockFinished } from './prompt/parseBlock.ts';
import { telemetryRejected, telemetryAccepted } from './ghostText/telemetry.ts';
import { telemetry, type TelemetryData, type TelemetryWithExp } from './telemetry.ts';
import { computeCompCharLen, computeCompletionText, SuggestionStatus } from './suggestions/partialSuggestions.ts';
import { isRunningInTest } from './testing/runtimeMode.ts';
import { PromiseQueue } from './util/promiseQueue.ts';
import { PostInsertionNotifier } from './postInsertionNotifier.ts';
import { lexEditDistance, editDistance } from './suggestions/editDistance.ts';
import { ChangeTracker } from './changeTracker.ts';
import { Logger, LogLevel } from './logger.ts';
import { TelemetryProperties, TelemetryStore } from './types.ts';
import { Position } from 'vscode-languageserver-types';

type CaptureCodeResult = {
  prompt: Omit<Prompt, 'prefixTokens' | 'suffixTokens'>;
  capturedCode: string;
  terminationOffset: number;
};

type Timeout = {
  seconds: number;
  captureCode: boolean;
  captureRejection: boolean;
};

const postInsertionLogger = new Logger(LogLevel.INFO, 'postInsertion');
const captureTimeouts: Timeout[] = [
  { seconds: 15, captureCode: false, captureRejection: false },
  { seconds: 30, captureCode: true, captureRejection: true },
  { seconds: 120, captureCode: false, captureRejection: false },
  { seconds: 300, captureCode: false, captureRejection: false },
  { seconds: 600, captureCode: false, captureRejection: false },
];
const stillInCodeNearMargin = 50;
const stillInCodeFarMargin = 1500;
const stillInCodeFraction = 0.5;
const captureCodeMargin = 500;
const postInsertConfiguration = {
  triggerPostInsertionSynchroneously: false,
  captureCode: false,
  captureRejection: false,
};

async function captureCode(
  ctx: Context,
  fileURI: URI,
  completionTelemetry: TelemetryWithExp,
  offset: number,
  suffixOffset?: number
): Promise<CaptureCodeResult> {
  const document = await ctx.get(TextDocumentManager).getTextDocument(fileURI);
  if (!document) {
    postInsertionLogger.info(ctx, `Could not get document for ${fileURI}. Maybe it was closed by the editor.`);
    return {
      prompt: { prefix: '', suffix: '', isFimEnabled: false, promptElementRanges: [] },
      capturedCode: '',
      terminationOffset: 0,
    };
  }

  const documentText = document.getText();
  const documentTextBefore = documentText.substring(0, offset);
  const position = document.positionAt(offset);
  const hypotheticalPromptResponse = await extractPrompt(ctx, document, position, completionTelemetry);
  const hypotheticalPrompt =
    hypotheticalPromptResponse.type === 'prompt'
      ? hypotheticalPromptResponse.prompt
      : { prefix: documentTextBefore, suffix: '', isFimEnabled: false, promptElementRanges: [] };

  if (hypotheticalPrompt.isFimEnabled && suffixOffset !== undefined) {
    const capturedCode = documentText.substring(offset, suffixOffset);
    hypotheticalPrompt.suffix = documentText.substring(suffixOffset);
    return { prompt: hypotheticalPrompt, capturedCode, terminationOffset: 0 };
  } else {
    const hypotheticalResponse = documentText.substring(offset);
    const contextIndent = contextIndentationFromText(documentTextBefore, offset, document.languageId);
    const terminationResult = await indentationBlockFinished(contextIndent, undefined)(hypotheticalResponse);
    const maxOffset = Math.min(
      documentText.length,
      offset + (terminationResult ? terminationResult * 2 : captureCodeMargin)
    );
    const capturedCode = documentText.substring(offset, maxOffset);
    return {
      prompt: hypotheticalPrompt,
      capturedCode,
      terminationOffset: terminationResult ?? -1,
    };
  }
}

function postRejectionTasks(
  ctx: Context,
  insertionCategory: string,
  insertionOffset: number,
  fileURI: URI,
  completions: { completionText: string; completionTelemetryData: TelemetryWithExp }[]
): void {
  for (const { completionText, completionTelemetryData } of completions) {
    postInsertionLogger.debug(
      ctx,
      `${insertionCategory}.rejected choiceIndex: ${completionTelemetryData.properties.choiceIndex}`
    );
    telemetryRejected(ctx, insertionCategory, completionTelemetryData);
  }

  const positionTracker = new ChangeTracker(ctx, fileURI, insertionOffset - 1);
  const suffixTracker = new ChangeTracker(ctx, fileURI, insertionOffset);

  for (const t of captureTimeouts.filter((t) => t.captureRejection)) {
    positionTracker.push(async () => {
      postInsertionLogger.debug(ctx, `Original offset: ${insertionOffset}, Tracked offset: ${positionTracker.offset}`);
      const { completionTelemetryData } = completions[0];
      const { prompt, capturedCode, terminationOffset } = await captureCode(
        ctx,
        fileURI,
        completionTelemetryData,
        positionTracker.offset + 1,
        suffixTracker.offset
      );
      const promptTelemetry: TelemetryProperties = prompt.isFimEnabled
        ? {
            hypotheticalPromptPrefixJson: JSON.stringify(prompt.prefix),
            hypotheticalPromptSuffixJson: JSON.stringify(prompt.suffix),
          }
        : { hypotheticalPromptJson: JSON.stringify(prompt.prefix) };
      const customTelemetryData = completionTelemetryData.extendedBy(
        { ...promptTelemetry, capturedCodeJson: JSON.stringify(capturedCode) },
        {
          timeout: t.seconds,
          insertionOffset,
          trackedOffset: positionTracker.offset,
          terminationOffsetInCapturedCode: terminationOffset,
        }
      );
      postInsertionLogger.debug(
        ctx,
        `${insertionCategory}.capturedAfterRejected choiceIndex: ${completionTelemetryData.properties.choiceIndex}`,
        customTelemetryData
      );
      telemetry(ctx, insertionCategory + `.capturedAfterRejected`, customTelemetryData, TelemetryStore.RESTRICTED);
    }, t.seconds * 1000);
  }
}

async function postInsertionTasks(
  ctx: Context,
  insertionCategory: string,
  completionText: string,
  insertionOffset: number,
  fileURI: URI,
  telemetryData: TelemetryWithExp,
  suggestionStatus: SuggestionStatus,
  completionId: string,
  // Position ./ghostText/last.ts
  start: Position
): Promise<void> {
  const telemetryDataWithStatus = telemetryData.extendedBy(
    { compType: suggestionStatus.compType },
    { compCharLen: computeCompCharLen(suggestionStatus, completionText) }
  );
  postInsertionLogger.debug(
    ctx,
    `${insertionCategory}.accepted choiceIndex: ${telemetryDataWithStatus.properties.choiceIndex}`
  );
  telemetryAccepted(ctx, insertionCategory, telemetryDataWithStatus);
  completionText = computeCompletionText(completionText, suggestionStatus);

  const trimmedCompletion = completionText.trim();
  const tracker = new ChangeTracker(ctx, fileURI, insertionOffset);
  const suffixTracker = new ChangeTracker(ctx, fileURI, insertionOffset + completionText.length);

  const stillInCodeCheck = async (timeout: Timeout) => {
    await checkStillInCode(
      ctx,
      insertionCategory,
      trimmedCompletion,
      insertionOffset,
      fileURI,
      timeout,
      telemetryDataWithStatus,
      tracker,
      suffixTracker
    );
  };

  if (postInsertConfiguration.triggerPostInsertionSynchroneously && isRunningInTest(ctx)) {
    const check = stillInCodeCheck({
      seconds: 0,
      captureCode: postInsertConfiguration.captureCode,
      captureRejection: postInsertConfiguration.captureRejection,
    });
    ctx.get(PromiseQueue).register(check);
  } else {
    captureTimeouts.forEach((timeout) => tracker.push(() => stillInCodeCheck(timeout), timeout.seconds * 1000));
  }

  ctx.get(PostInsertionNotifier).emit('onPostInsertion', {
    ctx,
    insertionCategory,
    insertionOffset,
    fileURI,
    completionText,
    telemetryData,
    completionId,
    start,
  });
}

// type FindResult = {
//   relativeLexEditDistance: number;
//   charEditDistance: number;
//   completionLexLength: number;
//   foundOffset: number;
//   lexEditDistance: number;
//   stillInCodeHeuristic: 1 | 0;
// };

function find(documentText: string, completion: string, margin: number, offset: number) {
  const window = documentText.substring(
    Math.max(0, offset - margin),
    Math.min(documentText.length, offset + completion.length + margin)
  );
  const lexAlignment = lexEditDistance(window, completion);
  const fraction = lexAlignment.lexDistance / lexAlignment.needleLexLength;
  const { distance: charEditDistance } = editDistance(
    window.substring(lexAlignment.startOffset, lexAlignment.endOffset),
    completion
  );

  return {
    relativeLexEditDistance: fraction,
    charEditDistance,
    completionLexLength: lexAlignment.needleLexLength,
    foundOffset: lexAlignment.startOffset + Math.max(0, offset - margin),
    lexEditDistance: lexAlignment.lexDistance,
    stillInCodeHeuristic: fraction <= stillInCodeFraction ? 1 : 0,
  };
}

async function checkStillInCode(
  ctx: Context,
  insertionCategory: string,
  completion: string,
  insertionOffset: number,
  fileURI: URI,
  timeout: Timeout,
  telemetryData: TelemetryWithExp,
  tracker: ChangeTracker,
  suffixTracker: ChangeTracker
): Promise<void> {
  const document = await ctx.get(TextDocumentManager).getTextDocument(fileURI);
  if (document) {
    const documentText = document.getText();
    let finding = find(documentText, completion, stillInCodeNearMargin, tracker.offset);
    if (!finding.stillInCodeHeuristic) {
      finding = find(documentText, completion, stillInCodeFarMargin, tracker.offset);
    }

    postInsertionLogger.debug(
      ctx,
      `stillInCode: ${finding.stillInCodeHeuristic ? 'Found' : 'Not found'}! Completion '${completion}' in file ${fileURI}. lexEditDistance fraction was ${finding.relativeLexEditDistance}. Char edit distance was ${finding.charEditDistance}. Inserted at ${insertionOffset}, tracked at ${tracker.offset}, found at ${finding.foundOffset}. choiceIndex: ${telemetryData.properties.choiceIndex}`
    );
    const customTelemetryData = telemetryData
      .extendedBy({}, { timeout: timeout.seconds, insertionOffset, trackedOffset: tracker.offset })
      .extendedBy({}, finding);
    telemetry(ctx, insertionCategory + '.stillInCode', customTelemetryData);

    if (timeout.captureCode) {
      const { prompt, capturedCode, terminationOffset } = await captureCode(
        ctx,
        fileURI,
        customTelemetryData,
        tracker.offset,
        suffixTracker.offset
      );
      const promptTelemetry: TelemetryProperties = prompt.isFimEnabled
        ? {
            hypotheticalPromptPrefixJson: JSON.stringify(prompt.prefix),
            hypotheticalPromptSuffixJson: JSON.stringify(prompt.suffix),
          }
        : { hypotheticalPromptJson: JSON.stringify(prompt.prefix) };
      const afterAcceptedTelemetry = telemetryData.extendedBy(
        { ...promptTelemetry, capturedCodeJson: JSON.stringify(capturedCode) },
        {
          timeout: timeout.seconds,
          insertionOffset,
          trackedOffset: tracker.offset,
          terminationOffsetInCapturedCode: terminationOffset,
        }
      );
      postInsertionLogger.debug(
        ctx,
        `${insertionCategory}.capturedAfterAccepted choiceIndex: ${telemetryData.properties.choiceIndex}`,
        customTelemetryData
      );
      telemetry(ctx, insertionCategory + '.capturedAfterAccepted', afterAcceptedTelemetry, TelemetryStore.RESTRICTED);
    }
  }
}

export {
  postRejectionTasks,
  postInsertionLogger,
  captureTimeouts,
  stillInCodeNearMargin,
  stillInCodeFarMargin,
  stillInCodeFraction,
  captureCodeMargin,
  postInsertConfiguration,
  postInsertionTasks,
};
