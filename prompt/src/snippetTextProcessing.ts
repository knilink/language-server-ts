import { ITokenizer } from './tokenization';
import { truncateFirstLinesFirst } from './textProcessing/truncateFirstLinesFirst';
import { Element } from './types';
// import { } from './wishlist'; // circular deps, TODO

class SnippetTextProcessor {
  private kindToFunctionMap: Map<
    string,
    (
      tokenizer: ITokenizer,
      snippet: Element,
      targetTokenBudget: number
    ) => { summarizedElement: Element; removedMaterial: Element }
  >;

  constructor(preset: string = 'default') {
    switch (preset) {
      case 'default':
      default:
        this.kindToFunctionMap = new Map([['BeforeCursor', truncateFirstLinesFirst]]);
    }
  }

  isSummarizationAvailable(kind: string): boolean {
    return this.kindToFunctionMap.has(kind);
  }

  summarize(
    tokenizer: ITokenizer,
    snippet: Element,
    targetTokenBudget: number
  ): { summarizedElement: Element; removedMaterial: Element } {
    const summarizeFn = this.kindToFunctionMap.get(snippet.kind);
    if (summarizeFn) {
      return summarizeFn(tokenizer, snippet, targetTokenBudget);
    } else {
      throw new Error(`Summarization function for kind "${snippet.kind}" not available`);
    }
  }
}

export { SnippetTextProcessor };
