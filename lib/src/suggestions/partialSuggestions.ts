import type { Range } from 'vscode-languageserver-types';

type SuggestionStatus = { compType: 'full' } | { compType: 'partial'; acceptedLength?: number };

function computeCompCharLen(suggestionStatus: SuggestionStatus, completionText: string): number {
  return suggestionStatus.compType === 'partial' && suggestionStatus.acceptedLength !== undefined
    ? suggestionStatus.acceptedLength
    : completionText.length;
}

function computeCompletionText(completionText: string, suggestionStatus: SuggestionStatus): string {
  return suggestionStatus.compType === 'partial' && suggestionStatus.acceptedLength !== undefined
    ? completionText.substring(0, suggestionStatus.acceptedLength)
    : completionText;
}

type CompletionItem = {
  displayText: string;
  insertText: string;
  range: Range;
};

function computePartialLength(
  cmp: CompletionItem,
  acceptedLength: number,
  triggerKind: number // TODO: enum
): number {
  return (cmp.displayText !== cmp.insertText && cmp.insertText.trim() === cmp.displayText) || triggerKind === 3
    ? acceptedLength
    : acceptedLength - cmp.range.end.character + cmp.range.start.character;
}

export { computeCompCharLen, computeCompletionText, computePartialLength, SuggestionStatus };
