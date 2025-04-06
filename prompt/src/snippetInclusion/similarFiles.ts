import { OpenDocument, CurrentDocument, Snippet, type SimilarFilesOptions } from '../types.ts';
import { FixedWindowSizeJaccardMatcher } from './jaccardMatching.ts';
import { BlockTokenSubsetMatcher } from './subsetMatching.ts';

function getMatcher(doc: CurrentDocument, selection: SimilarFilesOptions): FixedWindowSizeJaccardMatcher {
  return (
    selection.useSubsetMatching
      ? BlockTokenSubsetMatcher.FACTORY(selection.snippetLength)
      : FixedWindowSizeJaccardMatcher.FACTORY(selection.snippetLength)
  ).to(doc);
}

async function getSimilarSnippets(
  doc: CurrentDocument,
  similarFiles: OpenDocument[],
  options: SimilarFilesOptions
): Promise<Snippet[]> {
  const matcher = getMatcher(doc, options);

  if (options.maxTopSnippets === 0) return [];

  return (
    await similarFiles
      .filter((similarFile) => similarFile.source.length < options.maxCharPerFile && similarFile.source.length > 0)
      .slice(0, options.maxNumberOfFiles)
      .reduce<Promise<Snippet[]>>(
        async (acc, similarFile) =>
          (await acc).concat(
            (await matcher.findMatches(similarFile, options.maxSnippetsPerFile)).map((snippet) => ({
              relativePath: similarFile.relativePath,
              ...snippet,
            }))
          ),
        Promise.resolve([])
      )
  )
    .filter((similarFile) => similarFile.score && similarFile.snippet && similarFile.score > options.threshold)
    .sort((a, b) => a.score - b.score)
    .slice(-options.maxTopSnippets);
}

const DEFAULT_SNIPPET_THRESHOLD = 0;
const DEFAULT_SNIPPET_WINDOW_SIZE = 60;
const DEFAULT_MAX_TOP_SNIPPETS = 4;
const DEFAULT_MAX_SNIPPETS_PER_FILE = 1;
const DEFAULT_MAX_NUMBER_OF_FILES = 20;
const DEFAULT_MAX_CHARACTERS_PER_FILE = 10_000;
const defaultSimilarFilesOptions: SimilarFilesOptions = {
  snippetLength: DEFAULT_SNIPPET_WINDOW_SIZE,
  threshold: DEFAULT_SNIPPET_THRESHOLD,
  maxTopSnippets: DEFAULT_MAX_TOP_SNIPPETS,
  maxCharPerFile: DEFAULT_MAX_CHARACTERS_PER_FILE,
  maxNumberOfFiles: DEFAULT_MAX_NUMBER_OF_FILES,
  maxSnippetsPerFile: DEFAULT_MAX_SNIPPETS_PER_FILE,
  useSubsetMatching: false,
};
const defaultCppSimilarFilesOptions: SimilarFilesOptions = {
  snippetLength: 60,
  threshold: 0,
  maxTopSnippets: 16,
  maxCharPerFile: 100_000,
  maxNumberOfFiles: 200,
  maxSnippetsPerFile: 4,
  // added
  useSubsetMatching: false,
};

export { defaultCppSimilarFilesOptions, defaultSimilarFilesOptions, getSimilarSnippets, SimilarFilesOptions };
