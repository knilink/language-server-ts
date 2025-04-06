import { Unknown, TelemetryStore } from './types.ts';
import type { TelemetryProperties } from './types.ts';
import type { Prompt } from '../../prompt/src/types.ts';
import type { TelemetryWithExp } from './telemetry.ts';
import type { Context } from './context.ts';
import type { DocumentUri, Position } from 'vscode-languageserver-types';
import type { SuggestionStatus } from './suggestions/partialSuggestions.ts';

import { ChangeTracker } from './changeTracker.ts';
import { CitationManager } from './citationManager.ts';
import { telemetryAccepted, telemetryRejected } from './ghostText/telemetry.ts';
import { Logger } from './logger.ts';
import { PostInsertionNotifier } from './postInsertionNotifier.ts';
import { contextIndentationFromText, indentationBlockFinished } from './prompt/parseBlock.ts';
import { extractPrompt } from './prompt/prompt.ts';
import { editDistance, lexEditDistance } from './suggestions/editDistance.ts';
import { computeCompCharLen, computeCompletionText } from './suggestions/partialSuggestions.ts';
import { telemetry, telemetryCatch } from './telemetry.ts';
import { isRunningInTest } from './testing/runtimeMode.ts';
import { TextDocumentManager } from './textDocumentManager.ts';
import { PromiseQueue } from './util/promiseQueue.ts';

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

const postInsertionLogger = new Logger('postInsertion');
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
  uri: DocumentUri,
  completionTelemetry: TelemetryWithExp,
  offset: number,
  suffixOffset?: number
): Promise<CaptureCodeResult> {
  const document = await ctx.get(TextDocumentManager).getTextDocument({ uri });
  if (!document) {
    postInsertionLogger.info(ctx, `Could not get document for ${uri}. Maybe it was closed by the editor.`);
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
  uri: DocumentUri,
  completions: { completionText: string; completionTelemetryData: TelemetryWithExp }[]
): void {
  for (const { completionText, completionTelemetryData } of completions) {
    postInsertionLogger.debug(
      ctx,
      `${insertionCategory}.rejected choiceIndex: ${completionTelemetryData.properties.choiceIndex}`
    );
    telemetryRejected(ctx, insertionCategory, completionTelemetryData);
  }

  const positionTracker = new ChangeTracker(ctx, uri, insertionOffset - 1);
  const suffixTracker = new ChangeTracker(ctx, uri, insertionOffset);

  const checkInCode = async (t: Timeout) => {
    postInsertionLogger.debug(ctx, `Original offset: ${insertionOffset}, Tracked offset: ${positionTracker.offset}`);
    const { completionTelemetryData } = completions[0];

    const { prompt, capturedCode, terminationOffset } = await captureCode(
      ctx,
      uri,
      completionTelemetryData,
      positionTracker.offset + 1,
      suffixTracker.offset
    );

    let promptTelemetry;

    if (prompt.isFimEnabled) {
      promptTelemetry = {
        hypotheticalPromptPrefixJson: JSON.stringify(prompt.prefix),
        hypotheticalPromptSuffixJson: JSON.stringify(prompt.suffix),
      };
    } else {
      promptTelemetry = { hypotheticalPromptJson: JSON.stringify(prompt.prefix) };
    }

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

    telemetry(ctx, insertionCategory + '.capturedAfterRejected', customTelemetryData, 1);
  };

  captureTimeouts
    .filter((t) => t.captureRejection)
    .map((t) =>
      positionTracker.push(
        telemetryCatch(ctx, () => checkInCode(t), 'postRejectionTasks'),
        t.seconds * 1000
      )
    );
}

function postInsertionTasks(
  ctx: Context,
  insertionCategory: string,
  completionText: string,
  insertionOffset: number,
  uri: DocumentUri,
  telemetryData: TelemetryWithExp,
  suggestionStatus: SuggestionStatus,
  // Position ./ghostText/last.ts
  start: Position,
  copilotAnnotations?: { ip_code_citations?: Unknown.Annotation[] }
): void {
  const telemetryDataWithStatus = telemetryData.extendedBy(
    { compType: suggestionStatus.compType },
    { compCharLen: computeCompCharLen(suggestionStatus, completionText) }
  );
  postInsertionLogger.debug(
    ctx,
    `${insertionCategory}.accepted choiceIndex: ${telemetryDataWithStatus.properties.choiceIndex}`
  );
  telemetryAccepted(ctx, insertionCategory, telemetryDataWithStatus);
  const fullCompletionText = completionText;
  completionText = computeCompletionText(completionText, suggestionStatus);

  const trimmedCompletion = completionText.trim();
  const tracker = new ChangeTracker(ctx, uri, insertionOffset);
  const suffixTracker = new ChangeTracker(ctx, uri, insertionOffset + completionText.length);

  const stillInCodeCheck = async (timeout: Timeout) => {
    await checkStillInCode(
      ctx,
      insertionCategory,
      trimmedCompletion,
      insertionOffset,
      uri,
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
    captureTimeouts.map((timeout) =>
      tracker.push(
        telemetryCatch(ctx, () => stillInCodeCheck(timeout), 'postInsertionTasks'),
        timeout.seconds * 1000
      )
    );
  }

  ctx.get(PostInsertionNotifier).emit('onPostInsertion', {
    ctx,
    insertionCategory,
    insertionOffset,
    uri,
    completionText,
    telemetryData,
    start,
  });

  telemetryCatch(ctx, citationCheck, 'post insertion citation check')(
    ctx,
    uri,
    fullCompletionText,
    completionText,
    insertionOffset,
    copilotAnnotations
  );
}

async function citationCheck(
  ctx: Context,
  uri: DocumentUri,
  fullCompletionText: string,
  insertedText: string,
  insertionOffset: number,
  copilotAnnotations?: { ip_code_citations?: Unknown.Annotation[] }
): Promise<void> {
  if (!copilotAnnotations?.ip_code_citations?.length) {
    return;
  }
  const doc = await ctx.get(TextDocumentManager).getTextDocument({ uri });
  if (doc) {
    const found = find(doc.getText(), insertedText, stillInCodeNearMargin, insertionOffset);

    if (found.stillInCodeHeuristic) {
      insertionOffset = found.foundOffset;
    }
  }
  for (const citation of copilotAnnotations.ip_code_citations) {
    const citationStart = computeCitationStart(fullCompletionText.length, insertedText.length, citation.start_offset);
    if (citationStart === undefined) {
      postInsertionLogger.info(
        ctx,
        `Full completion for ${uri} contains a reference matching public code, but the partially inserted text did not include the match.`
      );
      continue;
    }
    const offsetStart = insertionOffset + citationStart;
    const start = doc?.positionAt(offsetStart);

    const offsetEnd =
      insertionOffset + computeCitationEnd(fullCompletionText.length, insertedText.length, citation.stop_offset);

    const end = doc?.positionAt(offsetEnd);
    const text = start && end ? doc?.getText({ start, end }) : '<unknown>';
    await ctx.get(CitationManager).handleIPCodeCitation(ctx, {
      inDocumentUri: uri,
      offsetStart,
      offsetEnd,
      version: doc?.version,
      location: start && end ? { start, end } : undefined,
      matchingText: text,
      details: citation.details.citations,
    });
  }
}

function computeCitationStart(
  completionLength: number,
  insertedLength: number,
  citationStartOffset: number
): number | undefined {
  if (!(insertedLength < completionLength && citationStartOffset > insertedLength)) {
    return citationStartOffset;
  }
}

function computeCitationEnd(completionLength: number, insertedLength: number, citationStopOffset: number): number {
  return insertedLength < completionLength ? Math.min(citationStopOffset, insertedLength) : citationStopOffset;
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
  uri: DocumentUri,
  timeout: Timeout,
  telemetryData: TelemetryWithExp,
  tracker: ChangeTracker,
  suffixTracker: ChangeTracker
): Promise<void> {
  const document = await ctx.get(TextDocumentManager).getTextDocument({ uri });
  if (document) {
    const documentText = document.getText();
    let finding = find(documentText, completion, stillInCodeNearMargin, tracker.offset);
    if (!finding.stillInCodeHeuristic) {
      finding = find(documentText, completion, stillInCodeFarMargin, tracker.offset);
    }

    postInsertionLogger.debug(
      ctx,
      `stillInCode: ${finding.stillInCodeHeuristic ? 'Found' : 'Not found'}! Completion '${completion}' in file ${uri}. lexEditDistance fraction was ${finding.relativeLexEditDistance}. Char edit distance was ${finding.charEditDistance}. Inserted at ${insertionOffset}, tracked at ${tracker.offset}, found at ${finding.foundOffset}. choiceIndex: ${telemetryData.properties.choiceIndex}`
    );
    const customTelemetryData = telemetryData
      .extendedBy({}, { timeout: timeout.seconds, insertionOffset, trackedOffset: tracker.offset })
      .extendedBy({}, finding);
    telemetry(ctx, insertionCategory + '.stillInCode', customTelemetryData);

    if (timeout.captureCode) {
      const { prompt, capturedCode, terminationOffset } = await captureCode(
        ctx,
        uri,
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
