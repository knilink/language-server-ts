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

export { computeCompCharLen, computeCompletionText, SuggestionStatus };
