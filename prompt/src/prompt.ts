import { defaultCppSimilarFilesOptions, defaultSimilarFilesOptions } from './snippetInclusion/similarFiles.ts';
import { LanguageId, Snippet, PromptInfo, IPromptOptions, SimilarFilesOptions, CurrentDocument } from './types.ts';
import { SnippetTextProcessor } from './snippetTextProcessing.ts';
import { processSnippetsForWishlist } from './snippetInclusion/snippets.ts';
import { transferLastLineToTooltipSignature } from './tooltipSignature.ts';
import { getTokenizer } from './tokenization/index.ts';
import { kindForSnippetProviderType, PromptWishlist, PromptOrderList, PromptPriorityList } from './wishlist.ts';

let cachedSuffix: { text: string; tokens: number[] } = { text: '', tokens: [] };
const DEFAULT_MAX_COMPLETION_LENGTH = 500;
const DEFAULT_MAX_PROMPT_LENGTH = 8192 - DEFAULT_MAX_COMPLETION_LENGTH;
const DEFAULT_NUM_SNIPPETS = 4;
const MAX_TOOLTIP_SIGNATURE_TOKENS = 150;
const DEFAULT_SUFFIX_MATCH_THRESHOLD = 10;
const DEFAULT_SUFFIX_PERCENT = 15;

const languageNormalizationMap: { [key: string]: LanguageId } = {
  javascriptreact: 'javascript',
  jsx: 'javascript',
  typescriptreact: 'typescript',
  jade: 'pug',
  cshtml: 'razor',
  c: 'cpp',
};

function normalizeLanguageId(languageId: LanguageId): LanguageId {
  return languageNormalizationMap[languageId.toLowerCase()] ?? languageId;
}

async function getPrompt(
  doc: CurrentDocument,
  options: Partial<PromptOptions> = {},
  snippets: Snippet[] = []
): Promise<PromptInfo> {
  const completeOptions = new PromptOptions(options, doc.languageId);
  const tokenizer = getTokenizer(completeOptions.tokenizerName);
  const snippetTextProcessor = new SnippetTextProcessor(completeOptions.snippetTextProcessingPreset);
  const promptOrderList = new PromptOrderList(completeOptions.promptOrderListPreset);
  const promptPriorityList = new PromptPriorityList(completeOptions.promptPriorityPreset);

  const { source, languageId, offset } = doc;
  const normalizedLanguageId = normalizeLanguageId(languageId);
  doc.languageId = normalizedLanguageId; // MARK: mutate

  const promptWishlist = new PromptWishlist(
    tokenizer,
    completeOptions.lineEnding,
    promptOrderList,
    snippetTextProcessor,
    promptPriorityList
  );
  const pathSnippet = snippets.find((s) => s.provider === 'path');
  const languageSnippet = snippets.find((s) => s.provider === 'language');
  const traitsSnippet = snippets.find((s) => s.provider === 'trait');
  let tooltipSignatureSnippet = snippets.find((s) => s.provider === 'tooltip-signature');

  if (pathSnippet && pathSnippet.snippet.length > 0) {
    promptWishlist.append(pathSnippet.snippet, 'PathMarker');
    if (languageSnippet) {
      promptWishlist.extMarkUnused({
        text: languageSnippet.snippet,
        kind: 'LanguageMarker',
        tokens: tokenizer.tokenLength(languageSnippet.snippet),
        id: NaN,
        score: NaN,
      });
    }
  } else if (languageSnippet) {
    promptWishlist.append(languageSnippet.snippet, 'LanguageMarker');
  }

  if (traitsSnippet != null) {
    promptWishlist.append(traitsSnippet.snippet, 'Traits');
  }

  snippets = snippets.filter(
    (s) =>
      s.provider !== 'language' && s.provider !== 'path' && s.provider !== 'tooltip-signature' && s.provider !== 'trait'
  );

  function addSnippetsNow() {
    processSnippetsForWishlist(
      snippets,
      doc.languageId,
      tokenizer,
      promptPriorityList,
      completeOptions.numberOfSnippets
    ).forEach((snippet) => {
      let kind = kindForSnippetProviderType(snippet.provider);
      promptWishlist.append(snippet.announcedSnippet, kind, snippet.tokens, snippet.score);
    });
  }
  addSnippetsNow();

  let directContext = source.substring(0, offset);
  if (
    tooltipSignatureSnippet !== undefined &&
    tokenizer.tokenLength(tooltipSignatureSnippet.snippet) <= MAX_TOOLTIP_SIGNATURE_TOKENS
  ) {
    [directContext, tooltipSignatureSnippet] = transferLastLineToTooltipSignature(
      directContext,
      tooltipSignatureSnippet
    );
    promptWishlist.append(tooltipSignatureSnippet.snippet, 'TooltipSignature');
  } else if (tooltipSignatureSnippet) {
    promptWishlist.extMarkUnused({
      text: tooltipSignatureSnippet.snippet,
      kind: 'TooltipSignature',
      tokens: tokenizer.tokenLength(tooltipSignatureSnippet.snippet),
      id: NaN,
      score: NaN,
    });
  }
  promptWishlist.append(directContext, 'BeforeCursor');

  let suffixText = source.slice(offset);
  let { promptInfo, newCachedSuffix } = promptWishlist.fulfill(suffixText, completeOptions, cachedSuffix);
  cachedSuffix = newCachedSuffix;
  return promptInfo;
}

class PromptOptions implements IPromptOptions {
  maxPromptLength = DEFAULT_MAX_PROMPT_LENGTH;
  lineEnding: 'unix' = 'unix';
  tokenizerName = 'cl100k_base';
  suffixPercent = 15;
  suffixMatchThreshold = DEFAULT_SUFFIX_MATCH_THRESHOLD;
  promptOrderListPreset = 'default';
  promptPriorityPreset = 'default';
  snippetTextProcessingPreset = 'default';
  similarFilesOptions: SimilarFilesOptions;
  numberOfSnippets: number;
  // ../../lib/src/conversation/prompt/fromSkills.tsb
  // languageId?

  constructor(options: Partial<IPromptOptions>, languageId: LanguageId) {
    Object.assign(this, options);

    if (this.suffixPercent < 0 || this.suffixPercent > 100) {
      throw new Error(`suffixPercent must be between 0 and 100, but was ${this.suffixPercent}`);
    }

    if (this.suffixMatchThreshold < 0 || this.suffixMatchThreshold > 100) {
      throw new Error(`suffixMatchThreshold must be at between 0 and 100, but was ${this.suffixMatchThreshold}`);
    }

    if (languageId === 'cpp') {
      this.similarFilesOptions ??= defaultCppSimilarFilesOptions;
      this.numberOfSnippets ??= defaultCppSimilarFilesOptions.maxTopSnippets;
    } else {
      this.similarFilesOptions ??= defaultSimilarFilesOptions;
      this.numberOfSnippets ??= DEFAULT_NUM_SNIPPETS;
    }
  }
}

export {
  DEFAULT_MAX_COMPLETION_LENGTH,
  DEFAULT_MAX_PROMPT_LENGTH,
  DEFAULT_NUM_SNIPPETS,
  MAX_TOOLTIP_SIGNATURE_TOKENS,
  DEFAULT_SUFFIX_MATCH_THRESHOLD,
  DEFAULT_SUFFIX_PERCENT,
  normalizeLanguageId,
  getPrompt,
  PromptOptions,
};
