import { Document, Snippet } from "../types.ts";
import { FixedWindowSizeJaccardMatcher } from "./jaccardMatching.ts";

type Selection = {
  snippetLength: number;
  threshold: number;
  numberOfSnippets: number;
};

function getMatcher(doc: Document, selection: Selection, cacheReferenceTokens: boolean): FixedWindowSizeJaccardMatcher {
  return FixedWindowSizeJaccardMatcher.FACTORY(selection.snippetLength, cacheReferenceTokens).to(doc);
}

async function getSimilarSnippets(
  doc: Document,
  similarFiles: Document[],
  options: keyof typeof similarFileOptionToSelection,
  cacheReferenceTokens: boolean
): Promise<Snippet[]> {
  const selection = { ...similarFileOptionToSelection[options] };
  const matcher = getMatcher(doc, selection, cacheReferenceTokens);

  if (selection.numberOfSnippets === 0) return [];

  const validFiles = similarFiles
    .filter((similarFile) => similarFile.source.length < MAX_CHARACTERS_PER_FILE && similarFile.source.length > 0)
    .slice(0, MAX_NUMBER_OF_FILES);

  let acc: Snippet[] = [];

  for (const similarFile of validFiles) {
    const matches: Snippet[] = await matcher.findMatches(similarFile);
    acc = [
      ...acc,
      ...matches.map((snippet) => ({
        relativePath: similarFile.relativePath,
        ...snippet,
      })),
    ];
  }

  return acc
    .filter(
      (similarFile: Snippet) => similarFile.score && similarFile.snippet && similarFile.score > selection.threshold
    )
    .sort((a: Snippet, b: Snippet) => a.score - b.score)
    .slice(-selection.numberOfSnippets);
}

const similarFileOptionToSelection: Record<string, Selection> = {
  none: { snippetLength: 1, threshold: -1, numberOfSnippets: 0 },
  conservative: { snippetLength: 10, threshold: 0.3, numberOfSnippets: 1 },
  medium: { snippetLength: 20, threshold: 0.1, numberOfSnippets: 2 },
  eager: { snippetLength: 60, threshold: 0, numberOfSnippets: 4 },
  eagerButLittle: { snippetLength: 10, threshold: 0, numberOfSnippets: 1 },
  eagerButMedium: { snippetLength: 20, threshold: 0, numberOfSnippets: 4 },
  eagerButMuch: { snippetLength: 60, threshold: 0, numberOfSnippets: 6 },
  retrievalComparable: { snippetLength: 30, threshold: 0, numberOfSnippets: 4 },
};

const MAX_CHARACTERS_PER_FILE = 10_000;
const MAX_NUMBER_OF_FILES = 20;

export { getSimilarSnippets };
