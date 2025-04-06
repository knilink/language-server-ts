import { Position } from 'vscode-languageserver-types';

import { type Context } from '../context.ts';
import { type CopilotTextDocument } from '../textDocument.ts';
import { type APIChoice } from '../openai/openai.ts';

import { promptLibProxy } from '../prompt/promptLibProxy.ts';
import { isRepetitive } from './anomalyDetection.ts';
import { TelemetryData, telemetry } from '../telemetry.ts';
import { OpenAIRequestId, TelemetryStore } from '../types.ts';
import { Logger } from '../logger.ts';

function maybeSnipCompletion(ctx: Context, doc: CopilotTextDocument, position: Position, completion: string): string {
  let blockCloseToken = '}';
  try {
    blockCloseToken = promptLibProxy.getBlockCloseToken(doc.languageId) ?? '}';
  } catch {}
  return maybeSnipCompletionImpl(
    { getLineText: (lineIdx) => doc.lineAt(lineIdx).text, getLineCount: () => doc.lineCount },
    position,
    completion,
    blockCloseToken
  );
}

function maybeSnipCompletionImpl(
  doc: { getLineText: (lineIdx: number) => string; getLineCount: () => number },
  position: Position,
  completion: string,
  blockCloseToken: string
): string {
  const completionLinesInfo = splitByNewLine(completion);
  const completionLines = completionLinesInfo.lines;

  if (completionLines.length === 1) return completion;

  for (let completionLineStartIdx = 1; completionLineStartIdx < completionLines.length; completionLineStartIdx++) {
    let matched = true;
    let docSkippedEmptyLineCount = 0;
    let completionSkippedEmptyLineCount = 0;

    for (
      let offset = 0;
      offset + completionLineStartIdx + completionSkippedEmptyLineCount < completionLines.length;
      offset++
    ) {
      let docLine: string | undefined;
      while (true) {
        const docLineIdx = position.line + 1 + offset + docSkippedEmptyLineCount;
        docLine = docLineIdx >= doc.getLineCount() ? undefined : doc.getLineText(docLineIdx);
        if (docLine !== undefined && docLine.trim() === '') {
          docSkippedEmptyLineCount++;
        } else {
          break;
        }
      }

      let completionLineIdx;
      let completionLine;
      while (true) {
        completionLineIdx = completionLineStartIdx + offset + completionSkippedEmptyLineCount;
        completionLine = completionLineIdx >= completionLines.length ? undefined : completionLines[completionLineIdx];
        if (completionLine !== undefined && completionLine.trim() === '') {
          completionSkippedEmptyLineCount++;
        } else {
          break;
        }
      }

      const isLastCompletionLine = completionLineIdx === completionLines.length - 1;

      if (
        !completionLine ||
        !(isLastCompletionLine
          ? docLine?.startsWith(completionLine) || (docLine !== undefined && completionLine.startsWith(docLine))
          : docLine === completionLine && completionLine.trim() === blockCloseToken)
      ) {
        matched = false;
        break;
      }
    }
    if (matched) return completionLines.slice(0, completionLineStartIdx).join(completionLinesInfo.newLineCharacter);
  }
  return completion;
}

function splitByNewLine(text: string): { lines: string[]; newLineCharacter: string } {
  const newLineCharacter = text.includes('\r\n') ? '\r\n' : '\n';
  return { lines: text.split(newLineCharacter), newLineCharacter };
}

function matchesNextLine(document: CopilotTextDocument, position: Position, text: string): boolean {
  let nextLine = '';
  let lineNo = position.line + 1;
  while (nextLine === '' && lineNo < document.lineCount) {
    nextLine = document.lineAt(lineNo).text.trim();
    if (nextLine === text.trim()) return true;
    lineNo++;
  }
  return false;
}

async function postProcessChoiceInContext(
  ctx: Context,
  document: CopilotTextDocument,
  position: Position,
  choice: APIChoice,
  requestForNextLine: boolean,
  logger: Logger
): Promise<APIChoice | undefined> {
  if (isRepetitive(choice.tokens)) {
    const telemetryData = TelemetryData.createAndMarkAsIssued();
    telemetryData.extendWithRequestId(choice.requestId);
    telemetry(ctx, 'repetition.detected', telemetryData, 1);
    logger.info(ctx, 'Filtered out repetitive solution');
    return;
  }

  const postProcessedChoice = { ...choice };

  if (requestForNextLine) {
    postProcessedChoice.completionText = '\n' + postProcessedChoice.completionText;
  }

  if (matchesNextLine(document, position, postProcessedChoice.completionText)) {
    const baseTelemetryData = TelemetryData.createAndMarkAsIssued();
    baseTelemetryData.extendWithRequestId(choice.requestId);
    telemetry(ctx, 'completion.alreadyInDocument', baseTelemetryData);
    telemetry(
      ctx,
      'completion.alreadyInDocument',
      baseTelemetryData.extendedBy({ completionTextJson: JSON.stringify(postProcessedChoice.completionText) }),
      1
    );
    logger.info(ctx, 'Filtered out solution matching next line');
    return;
  }

  postProcessedChoice.completionText = maybeSnipCompletion(ctx, document, position, postProcessedChoice.completionText);

  return postProcessedChoice.completionText ? postProcessedChoice : undefined;
}

function checkSuffix(document: CopilotTextDocument, position: Position, choice: APIChoice): number {
  const restOfLine = document.lineAt(position.line).text.substring(position.character);
  if (restOfLine.length > 0) {
    if (choice.completionText.indexOf(restOfLine) !== -1) return restOfLine.length;
    let lastIndex = -1;
    let suffixLength = 0;
    for (const c of restOfLine) {
      const idx = choice.completionText.indexOf(c, lastIndex + 1);
      if (idx > lastIndex) {
        suffixLength++;
        lastIndex = idx;
      } else break;
    }
    return suffixLength;
  }
  return 0;
}

export { checkSuffix, postProcessChoiceInContext };
