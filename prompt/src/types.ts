import { URI } from 'vscode-uri';

export type LanguageId = string;

// ../../lib/src/prompt/similarFiles/neighborFiles.ts
export type Document = {
  languageId: LanguageId;
  // optional: ../../lib/src/prompt/prompt.ts
  relativePath?: string;
  source: string;
  offset?: number;
  // uri: URI; // don't know where this from
  uri: string; // lib/src/prompt/similarFiles/openTabFiles, uri: doc.uri.toString(),
};

export interface IPromptOptions {
  maxPromptLength: number;
  numberOfSnippets: number;
  similarFiles: string;
  lineEnding: 'unix';
  tokenizerName: string;
  suffixPercent: number;
  suffixMatchThreshold: number;
  promptOrderListPreset: string;
  promptPriorityPreset: string;
  snippetTextProcessingPreset: string;
  cacheReferenceTokens: boolean;
}

export type SnippetContext = {
  currentFile: Document;
  tooltipSignature?: string;
  similarFiles?: Document[];
  // ../../lib/src/prompt/prompt.ts options: new PromptOptions(promptOptions),
  options?: IPromptOptions;
};

export interface Element {
  id: number;
  kind: string;
  tokens: number;
  text: string;
  score: number;
}

export interface Snippet {
  provider: string;
  semantics: 'snippet';
  snippet: string;
  startLine: number;
  endLine: number;
  // Document['relativePath'] optional ./snippetInclusion/similarFiles.ts
  relativePath?: Document['relativePath'];
  score: number;
}

export type SnippetsResult = { snippets: Snippet[]; providerType: string; runtime: number };

export type SnippetsError = { error: unknown; providerType: 'string' };

export type PromptChoices = {
  used: Map<Element['kind'], number>;
  unused: Map<Element['kind'], number>;
  usedCounts: Map<Element['kind'], number>;
  unusedCounts: Map<Element['kind'], number>;
};

export type PromptBackground = {
  used: Map<Element['id'], { score: string; length: number }>;
  unused: Map<Element['id'], { score: string; length: number }>;
};

export type PromptElementRanges = {
  ranges: { kind: Element['kind']; start: number; end: number }[];
};

export type PromptInfo = {
  prefix: string;
  suffix: string;
  prefixLength: number;
  suffixLength: number;
  promptChoices: PromptChoices;
  promptBackground: PromptBackground;
  promptElementRanges: PromptElementRanges;
};

// partial ../../lib/src/postInsertion.ts
export type Prompt = {
  prefix: string;
  suffix: string;
  prefixTokens: number;
  suffixTokens: number;
  isFimEnabled: boolean;
  // ../../lib/src/prompt/prompt.ts
  promptElementRanges: PromptElementRanges['ranges'];
};
