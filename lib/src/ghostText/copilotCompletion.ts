import type { Position } from 'vscode-languageserver-types';
import type { Context } from '../context.ts';
import type { Result } from './ghostText.ts';
import type { CopilotTextDocument } from '../textDocument.ts';
import { CompletionResultType } from '../types.ts';
import type { Completion } from '../types.ts';

import { normalizeIndentCharacter } from './normalizeIndent.ts';
import { LocationFactory } from '../textDocument.ts';
import { v4 as uuidv4 } from 'uuid';
import type {} from '../ghostText/ghostText.ts';

// ../../../agent/src/methods/getCompletions.ts
type RawCompletion = Omit<Completion, 'triggerCategory'>;

function completionsFromGhostTextResults(
  ctx: Context,
  completionResults: Result[],
  resultType: number,
  document: CopilotTextDocument,
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
      uri: document.uri,
      index: result.completion.completionIndex,
      telemetry: result.telemetry,
      displayText: result.completion.displayText,
      position,
      offset: document.offsetAt(position),
      resultType,
      copilotAnnotations: result.copilotAnnotations,
    };
  });

  if (resultType === CompletionResultType.TypingAsSuggested && lastShownCompletionIndex !== undefined) {
    const lastShownCompletion = completions.find((predicate) => predicate.index === lastShownCompletionIndex);
    if (lastShownCompletion) {
      const restCompletions = completions.filter((predicate) => predicate.index !== lastShownCompletionIndex);
      return [lastShownCompletion, ...restCompletions];
    }
  }

  return completions;
}

export { completionsFromGhostTextResults };
