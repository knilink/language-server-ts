import { Document, Snippet, SimilarFilesOptions } from '../types.ts';
import { FixedWindowSizeJaccardMatcher } from './jaccardMatching.ts';

function parseNumberFromEnv(envName: string, defaultValue: number) {
  let env = process.env[envName];
  if (env === undefined) return defaultValue;
  let n = parseInt(env);
  return isNaN(n) ? defaultValue : n;
}

function getMatcher(doc: Document, selection: SimilarFilesOptions): FixedWindowSizeJaccardMatcher {
  return FixedWindowSizeJaccardMatcher.FACTORY(selection.snippetLength).to(doc);
}

async function getSimilarSnippets(
  doc: Document,
  similarFiles: Document[],
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
            matcher
              .findMatches(similarFile, options.maxSnippetsPerFile)
              .map((snippet) => ({ relativePath: similarFile.relativePath, ...snippet }))
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
};
const defaultCppSimilarFilesOptions: SimilarFilesOptions = {
  snippetLength: parseNumberFromEnv('GH_COPILOT_CPP_SNIPPET_WINDOW_SIZE', DEFAULT_SNIPPET_WINDOW_SIZE),
  threshold: parseNumberFromEnv('GH_COPILOT_CPP_SNIPPET_THRESHOLD', DEFAULT_SNIPPET_THRESHOLD),
  maxTopSnippets: parseNumberFromEnv('GH_COPILOT_CPP_MAX_TOP_SNIPPETS', DEFAULT_MAX_TOP_SNIPPETS),
  maxCharPerFile: parseNumberFromEnv('GH_COPILOT_CPP_MAX_CHARACTERS_PER_FILE', DEFAULT_MAX_CHARACTERS_PER_FILE),
  maxNumberOfFiles: parseNumberFromEnv('GH_COPILOT_CPP_MAX_NUMBER_OF_FILES', DEFAULT_MAX_NUMBER_OF_FILES),
  maxSnippetsPerFile: parseNumberFromEnv('GH_COPILOT_CPP_MAX_SNIPPETS_PER_FILE', DEFAULT_MAX_SNIPPETS_PER_FILE),
};

export { defaultCppSimilarFilesOptions, defaultSimilarFilesOptions, getSimilarSnippets, SimilarFilesOptions };
