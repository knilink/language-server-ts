import type { Position, Range } from 'vscode-languageserver-types';
import type { URI } from 'vscode-uri';
import { v4 as uuidv4 } from 'uuid';

import { type Context } from '../context';
import { type Result } from './ghostText';
import { LocationFactory, type TextDocument } from '../textDocument';
import { normalizeIndentCharacter } from './normalizeIndent';
// import { } from './normalizeIndent';
import { TelemetryData } from '../telemetry';
import { Completion, CompletionResultType } from '../types';

// ../../../agent/src/methods/getCompletions.ts
type RawCompletion = Omit<Completion, 'triggerCategory'>;

function completionsFromGhostTextResults(
  ctx: Context,
  completionResults: Result[],
  resultType: number,
  document: TextDocument,
  position: Position,
  // ../../../agent/src/methods/getCompletions.ts
  textEditorOptions?: { tabSize?: number; insertSpaces?: boolean },
  lastShownCompletionIndex?: number
): RawCompletion[] {
  const currentLine = document.lineAt(position);

  const completions = completionResults.map((result): RawCompletion => {
    const range = LocationFactory.range(
      LocationFactory.position(position.line, 0),
      LocationFactory.position(position.line, position.character + result.suffixCoverage)
    );
    let insertText = '';

    if (textEditorOptions) {
      result.completion = normalizeIndentCharacter(
        textEditorOptions,
        result.completion,
        currentLine.isEmptyOrWhitespace
      );

      if (
        currentLine.isEmptyOrWhitespace &&
        (result.completion.displayNeedsWsOffset || result.completion.completionText.startsWith(currentLine.text))
      ) {
        insertText = result.completion.completionText;
      } else {
        const rangeFromStart = LocationFactory.range(range.start, position);
        insertText = document.getText(rangeFromStart) + result.completion.displayText;
      }
    }

    return {
      uuid: uuidv4(),
      insertText: insertText,
      range,
      file: document.vscodeUri,
      index: result.completion.completionIndex,
      telemetry: result.telemetry,
      displayText: result.completion.displayText,
      position,
      offset: document.offsetAt(position),
      resultType,
    };
  });

  if (resultType === CompletionResultType.UserTyping && lastShownCompletionIndex !== undefined) {
    const lastShownCompletion = completions.find((predicate) => predicate.index === lastShownCompletionIndex);
    if (lastShownCompletion) {
      const restCompletions = completions.filter((predicate) => predicate.index !== lastShownCompletionIndex);
      return [lastShownCompletion, ...restCompletions];
    }
  }

  return completions;
}

export { completionsFromGhostTextResults };
