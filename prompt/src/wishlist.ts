import { Range } from 'vscode-languageserver-types';
import { ITokenizer } from './tokenization/index.ts';
// import { } from './lib'; // TODO: unused
import { findEditDistanceScore } from './suffixMatchCriteria.ts';
// import { } from './prompt'; // TODO: unused
import { Element, PromptInfo } from './types.ts';
import { SnippetTextProcessor } from './snippetTextProcessing.ts';

const MAX_EDIT_DISTANCE_LENGTH = 50;
const TOKENS_RESERVED_FOR_SUFFIX_ENCODING = 5;

function kindForSnippetProviderType(provider: string) {
  switch (provider) {
    case 'similar-files':
      return 'SimilarFile';
    case 'path':
      return 'PathMarker';
    case 'language':
      return 'LanguageMarker';
    case 'tooltip-signature':
      return 'TooltipSignature';
    default:
      throw new Error(`Unknown snippet provider type ${provider}`);
  }
}

class PromptBackground {
  used = new Map<Element['id'], { score: string; length: number }>();
  unused = new Map<Element['id'], { score: string; length: number }>();

  add(other: PromptBackground): void {
    for (let [id, element] of other.used) this.used.set(id, element);
    for (let [id, element] of other.unused) this.unused.set(id, element);
  }

  markUsed(element: Element): void {
    this.IsSnippet(element) && this.used.set(element.id, this.convert(element));
  }

  undoMarkUsed(element: Element): void {
    this.IsSnippet(element) && this.used.delete(element.id);
  }

  markUnused(element: Element): void {
    this.IsSnippet(element) && this.unused.set(element.id, this.convert(element));
  }

  private convert(element: Element): { score: string; length: number } {
    return { score: element.score.toFixed(4), length: element.text.length };
  }

  private IsSnippet(element: Element): boolean {
    return element.kind === 'SimilarFile' || element.kind === 'TooltipSignature';
  }
}

type PromptChoicesRecord = Map<Element['kind'], number>;
class PromptChoices {
  used: PromptChoicesRecord = new Map();
  unused: PromptChoicesRecord = new Map();
  usedCounts: PromptChoicesRecord = new Map();
  unusedCounts: PromptChoicesRecord = new Map();

  add(other: {
    used: PromptChoicesRecord;
    unused: PromptChoicesRecord;
    usedCounts: PromptChoicesRecord;
    unusedCounts: PromptChoicesRecord;
  }) {
    for (let [kind, count] of other.used) this.used.set(kind, (this.used.get(kind) || 0) + count);
    for (let [kind, count] of other.unused) this.unused.set(kind, (this.unused.get(kind) || 0) + count);
    for (let [kind, count] of other.usedCounts) this.usedCounts.set(kind, (this.usedCounts.get(kind) || 0) + count);
    for (let [kind, count] of other.unusedCounts)
      this.unusedCounts.set(kind, (this.unusedCounts.get(kind) || 0) + count);
  }

  markUsed(element: Element) {
    this.used.set(element.kind, (this.used.get(element.kind) || 0) + element.tokens);
    if (element.kind == 'BeforeCursor') {
      this.usedCounts.set(element.kind, (this.usedCounts.get(element.kind) || 0) + element.text.split('\n').length);
    } else this.usedCounts.set(element.kind, (this.usedCounts.get(element.kind) || 0) + 1);
  }

  undoMarkUsed(element: Element) {
    this.used.set(element.kind, (this.used.get(element.kind) || 0) - element.tokens);
    if (element.kind == 'BeforeCursor') {
      this.usedCounts.set(element.kind, (this.usedCounts.get(element.kind) || 0) - element.text.split('\n').length);
    } else this.usedCounts.set(element.kind, (this.usedCounts.get(element.kind) || 0) - 1);
  }

  markUnused(element: Element) {
    this.unused.set(element.kind, (this.unused.get(element.kind) || 0) + element.tokens);
    if (element.kind == 'BeforeCursor') {
      this.unusedCounts.set(element.kind, (this.unusedCounts.get(element.kind) || 0) + element.text.split('\n').length);
    } else this.unusedCounts.set(element.kind, (this.unusedCounts.get(element.kind) || 0) + 1);
  }
}

class PromptOrderList {
  protected _rankedList: string[];

  constructor(preset = 'default') {
    switch (preset) {
      default:
        this._rankedList = ['LanguageMarker', 'PathMarker', 'SimilarFile', 'BeforeCursor', 'TooltipSignature'];
    }
  }

  get rankedList() {
    return this._rankedList;
  }

  _sortElements(elements: Element[]): void {
    // MARK: original was elements.sort() which mutate
    elements.sort((a, b) => {
      const aIndex = this._rankedList.indexOf(a.kind);
      const bIndex = this._rankedList.indexOf(b.kind);
      if (aIndex === -1 || bIndex === -1)
        throw `Invalid element kind: ${a.kind} or ${b.kind}, not found in prompt element ordering list`;
      return aIndex === bIndex ? a.id - b.id : aIndex - bIndex;
    });
  }
}

class PromptPriorityList extends PromptOrderList {
  constructor(preset = 'default') {
    switch ((super(), preset)) {
      case 'office-exp':
        this._rankedList = ['PathMarker', 'TooltipSignature', 'BeforeCursor', 'SimilarFile', 'LanguageMarker'];
        break;
      default:
        this._rankedList = ['TooltipSignature', 'BeforeCursor', 'SimilarFile', 'PathMarker', 'LanguageMarker'];
    }
  }

  _sortElements(elements: Element[]): void {
    elements.sort((a, b) => {
      const aIndex = this._rankedList.indexOf(a.kind);
      const bIndex = this._rankedList.indexOf(b.kind);
      if (aIndex === -1 || bIndex === -1)
        throw `Invalid element kind: ${a.kind} or ${b.kind}, not found in snippet provider priority list`;
      return aIndex === bIndex ? b.id - a.id : aIndex - bIndex;
    });
  }
}

class PromptElementRanges {
  ranges: { kind: Element['kind']; start: number; end: number }[] = [];
  constructor(usedElements: Element[]) {
    let nextRangeStart = 0;
    let previousKind;
    for (let element of usedElements) {
      if (element.text.length !== 0) {
        if (previousKind === 'BeforeCursor' && element.kind === 'BeforeCursor') {
          this.ranges[this.ranges.length - 1].end += element.text.length;
        } else {
          this.ranges.push({
            kind: element.kind,
            start: nextRangeStart,
            end: nextRangeStart + element.text.length,
          });
        }
        previousKind = element.kind;
        nextRangeStart += element.text.length;
      }
    }
  }
}

class PromptWishlist {
  tokenizer: ITokenizer;
  lineEndingOption: 'unix';
  orderingList: PromptOrderList;
  snippetTextProcessor: SnippetTextProcessor;
  priorityList: PromptPriorityList;
  content: Element[] = [];
  basePromptBackground = new PromptBackground();
  baseTallyOfChoices = new PromptChoices();

  constructor(
    tokenizer: ITokenizer,
    lineEndingOption: 'unix',
    orderingList: PromptOrderList,
    snippetTextProcessor: SnippetTextProcessor,
    priorityList: PromptPriorityList
  ) {
    this.tokenizer = tokenizer;
    this.lineEndingOption = lineEndingOption;
    this.orderingList = orderingList;
    this.snippetTextProcessor = snippetTextProcessor;
    this.priorityList = priorityList;
  }
  extMarkUnused(element: Element) {
    this.basePromptBackground.markUnused(element);
    this.baseTallyOfChoices.markUnused(element);
  }
  getContent() {
    return [...this.content];
  }
  convertLineEndings(text: string) {
    if (this.lineEndingOption === 'unix') {
      text = text.replace(/\r\n?/g, '\\n');
    }
    return text;
  }
  maxPrefixTokenLength() {
    return this.content.reduce((sum, element) => sum + element.tokens, 0);
  }
  append(text: string, kind: string, tokens: number = this.tokenizer.tokenLength(text), score: number = NaN) {
    text = this.convertLineEndings(text);
    const id = this.content.length;
    this.content.push({ id, text, kind, tokens, score });
    return id;
  }
  fulfillPrefix(maxPromptLength: number): PromptInfo {
    let promptBackground = new PromptBackground();
    promptBackground.add(this.basePromptBackground);
    let tallyOfChoices = new PromptChoices();
    tallyOfChoices.add(this.baseTallyOfChoices);
    function markUsed(element: Element) {
      promptBackground.markUsed(element);
      tallyOfChoices.markUsed(element);
    }
    function undoMarkUsed(element: Element) {
      promptBackground.undoMarkUsed(element);
      tallyOfChoices.undoMarkUsed(element);
    }
    function markUnused(element: Element) {
      promptBackground.markUnused(element);
      tallyOfChoices.markUnused(element);
    }
    let budgetBreakingElement: Element | undefined;
    let remainingContent: Element[] = [];
    let remainingBudget = maxPromptLength;
    this.content.forEach((e: Element) => {
      if (remainingBudget > 0 || budgetBreakingElement === undefined) {
        let budgetUse = e.tokens;
        if (remainingBudget >= budgetUse) {
          remainingBudget -= budgetUse;
          markUsed(e);
          remainingContent.push(e);
        } else if (e.kind === 'BeforeCursor' && remainingBudget > 0) {
          let { summarizedElement: summarizedElement, removedMaterial: removedMaterial } =
            this.snippetTextProcessor.summarize(this.tokenizer, e, remainingBudget);
          e = summarizedElement;
          budgetUse = e.tokens;
          remainingBudget -= budgetUse;
          if (e.text.length > 0) {
            markUsed(e);
          }
          if (removedMaterial.text.length > 0) {
            markUnused(removedMaterial);
          }
          remainingContent.push(e);
        } else {
          if (budgetBreakingElement === undefined) {
            budgetBreakingElement = e;
          } else markUnused(e);
        }
      } else markUnused(e);
    });
    this.orderingList._sortElements(remainingContent);
    let prompt = remainingContent.reduce((a, b) => a + b.text, '');
    let promptLength = this.tokenizer.tokenLength(prompt);
    while (promptLength > maxPromptLength) {
      this.priorityList._sortElements(remainingContent);
      const removeAfterAll = remainingContent.pop();
      if (removeAfterAll) {
        undoMarkUsed(removeAfterAll);
        markUnused(removeAfterAll);
        if (budgetBreakingElement !== undefined) {
          markUnused(budgetBreakingElement);
        }
        budgetBreakingElement = undefined;
      }
      this.orderingList._sortElements(remainingContent);
      prompt = remainingContent.reduce((a, b) => a + b.text, '');
      promptLength = this.tokenizer.tokenLength(prompt);
    }
    let extendedContent = [...remainingContent];
    if (budgetBreakingElement !== undefined) {
      extendedContent.push(budgetBreakingElement);
      this.orderingList._sortElements(extendedContent);
      const innerPrompt = extendedContent.reduce((a, b) => a + b.text, '');
      const innerPromptLength = this.tokenizer.tokenLength(innerPrompt);
      if (innerPromptLength <= maxPromptLength) {
        markUsed(budgetBreakingElement);
        let promptElementRanges = new PromptElementRanges(extendedContent);
        return {
          prefix: innerPrompt,
          suffix: '',
          prefixLength: innerPromptLength,
          suffixLength: 0,
          promptChoices: tallyOfChoices,
          promptBackground: promptBackground,
          promptElementRanges: promptElementRanges,
        };
      } else markUnused(budgetBreakingElement);
    }
    const promptElementRanges = new PromptElementRanges(remainingContent);
    return {
      prefix: prompt,
      suffix: '',
      prefixLength: promptLength,
      suffixLength: 0,
      promptChoices: tallyOfChoices,
      promptBackground: promptBackground,
      promptElementRanges: promptElementRanges,
    };
  }
  fulfill(
    suffixText: string,
    completeOptions: { suffixPercent: number; maxPromptLength: number; suffixMatchThreshold: number },
    cachedSuffix: { text: string; tokens: number[] }
  ): { promptInfo: PromptInfo; newCachedSuffix: { text: string; tokens: number[] } } {
    if (completeOptions.suffixPercent === 0 || suffixText.length === 0) {
      return {
        promptInfo: this.fulfillPrefix(completeOptions.maxPromptLength),
        newCachedSuffix: cachedSuffix,
      };
    }
    const availableTokens = completeOptions.maxPromptLength - TOKENS_RESERVED_FOR_SUFFIX_ENCODING;
    let prefixTokenBudget = Math.floor((availableTokens * (100 - completeOptions.suffixPercent)) / 100);
    let suffixTokenBudget = availableTokens - prefixTokenBudget;
    const trimmedSuffixText = suffixText.trimStart();
    if (availableTokens > MAX_EDIT_DISTANCE_LENGTH && suffixTokenBudget < MAX_EDIT_DISTANCE_LENGTH)
      throw new Error(
        `Suffix budget is smaller than MAX_EDIT_DISTANCE_LENGTH: ${suffixTokenBudget} < ${MAX_EDIT_DISTANCE_LENGTH}\n`
      );
    const firstSuffixTokens = this.tokenizer.takeFirstTokens(trimmedSuffixText, MAX_EDIT_DISTANCE_LENGTH);
    let useCachedSuffix = false;
    if (
      firstSuffixTokens.tokens.length > 0 &&
      completeOptions.suffixMatchThreshold > 0 &&
      100 *
        findEditDistanceScore(firstSuffixTokens.tokens, cachedSuffix.tokens.slice(0, MAX_EDIT_DISTANCE_LENGTH))?.score <
        completeOptions.suffixMatchThreshold * firstSuffixTokens.tokens.length
    ) {
      useCachedSuffix = true;
    }

    let newCachedSuffix;
    if (useCachedSuffix) {
      prefixTokenBudget = availableTokens - cachedSuffix.tokens.length;
      newCachedSuffix = cachedSuffix;
    } else {
      const maxPrefixTokenLength = this.maxPrefixTokenLength();
      const maxSuffixTokenLength = this.tokenizer.tokenLength(trimmedSuffixText);

      if (maxPrefixTokenLength < prefixTokenBudget) {
        prefixTokenBudget = maxPrefixTokenLength;
        suffixTokenBudget = availableTokens - prefixTokenBudget;
      } else if (maxSuffixTokenLength < suffixTokenBudget) {
        prefixTokenBudget = availableTokens - maxSuffixTokenLength;
        suffixTokenBudget = maxSuffixTokenLength;
      }
      newCachedSuffix = this.tokenizer.takeFirstTokens(trimmedSuffixText, suffixTokenBudget);
    }
    const promptInfo = this.fulfillPrefix(prefixTokenBudget);
    promptInfo.suffix = newCachedSuffix.text;
    promptInfo.suffixLength = newCachedSuffix.tokens.length;
    return { promptInfo: promptInfo, newCachedSuffix: newCachedSuffix };
  }
}

export { kindForSnippetProviderType, PromptOrderList, PromptPriorityList, PromptWishlist };
