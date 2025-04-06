import { URI } from 'vscode-uri';

export type LanguageId = string;

// ../../lib/src/prompt/similarFiles/neighborFiles.ts
export type OpenDocument = {
  source: string;
  uri: string;
  // required ../../lib/src/prompt/similarFiles/openTabFiles.ts
  // undefined when uri is `untitled:` ../../lib/src/textDocumentManager.ts
  relativePath?: string;
};

export type CurrentDocument = OpenDocument & {
  languageId: LanguageId;
  offset: number;
};

// export type SimilarFileOption =
//   | 'none'
//   | 'conservative'
//   | 'medium'
//   | 'eager'
//   | 'eagerButLittle'
//   | 'eagerButMedium'
//   | 'eagerButMuch'
//   | 'retrievalComparable';

export type SimilarFilesOptions = {
  snippetLength: number;
  threshold: number;
  maxTopSnippets: number;
  maxCharPerFile: number;
  maxNumberOfFiles: number;
  maxSnippetsPerFile: number;
  // ./snippetInclusion/similarFiles.ts
  useSubsetMatching: boolean;
};

export interface IPromptOptions {
  maxPromptLength: number;
  numberOfSnippets: number;
  lineEnding: 'unix';
  tokenizerName: string;
  suffixPercent: number;
  suffixMatchThreshold: number;
  promptOrderListPreset: string;
  promptPriorityPreset: string;
  snippetTextProcessingPreset: string;

  // 1.40.0 maybe change
  // ./snippetInclusion/similarFiles.ts
  similarFilesOptions: SimilarFilesOptions;
}

// ../../lib/src/prompt/contextProviders/contextItemSchemas.ts
export interface CodeSnippet {
  uri: string;
  value: string;
  additionalUris?: string[];
  importance?: number;
  id?: string;
  //
  relativePath?: string;
}

export interface SnippetContext {
  currentFile: CurrentDocument;
  tooltipSignature?: string;
  similarFiles?: OpenDocument[];
  // ../../lib/src/prompt/prompt.ts options: new PromptOptions(promptOptions),
  options?: IPromptOptions;

  // delc ../../lib/src/prompt/contextProviders/contextItemSchemas.ts
  traits: ({ kind: 'string'; value: string } | { kind: 'name-value'; name: string; value: string })[];
  // ./snippetProviders/codeSnippet.ts
  codeSnippets?: CodeSnippet[];
}

export interface Element {
  id: number;
  kind: string;
  tokens: number;
  text: string;
  score: number;
}

export interface Snippet {
  provider: string;
  semantics: 'snippets' | 'snippet';
  snippet: string;
  startLine: number;
  endLine: number;
  // Document['relativePath'] optional ./snippetInclusion/similarFiles.ts
  relativePath?: CurrentDocument['relativePath'];
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
  // ../../lib/src/prompt/prompt.ts
  prefixTokens?: number;
  // ../../lib/src/prompt/prompt.ts
  suffixTokens?: number;
  isFimEnabled: boolean;
  // ../../lib/src/prompt/prompt.ts
  promptElementRanges: PromptElementRanges['ranges'];
};
