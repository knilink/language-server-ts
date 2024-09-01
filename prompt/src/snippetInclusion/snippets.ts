import { Snippet } from "../types.ts";
import { ITokenizer } from "../tokenization/index.ts";

import { commentBlockAsSingles } from "../languageMarker.ts";
import { kindForSnippetProviderType, PromptPriorityList } from "../wishlist.ts";

const snippetSemanticsToString = {
  function: 'function',
  snippet: 'snippet',
  variable: 'variable',
  parameter: 'parameter',
  method: 'method',
  class: 'class',
  module: 'module',
  alias: 'alias',
  'enum member': 'enum member',
  interface: 'interface',
};

function announceSnippet(snippet: Snippet, targetDocLanguageId: string): string {
  let semantics = snippetSemanticsToString[snippet.semantics];
  let headlinedSnippet = snippet.relativePath
    ? `Compare this ${semantics} from ${snippet.relativePath}:`
    : `Compare this ${semantics}:`;
  headlinedSnippet += `\n` + snippet.snippet;
  if (headlinedSnippet.endsWith('\n')) {
    headlinedSnippet += '\n';
  }
  return commentBlockAsSingles(headlinedSnippet, targetDocLanguageId);
}

function sortSnippetsDescending<T extends { score: number }>(snippets: T[]): void {
  snippets.sort((a, b) => b.score - a.score);
}

function selectSnippets(
  snippets: Snippet[],
  numberOfSnippets: number,
  promptPriorityList: PromptPriorityList
): Snippet[] {
  if (numberOfSnippets === 0) return [];
  const snippetsWithElementKind = snippets.map((snippet) => ({
    ...snippet,
    kind: kindForSnippetProviderType(snippet.provider),
  }));
  let allSnippets: Snippet[] = [];
  promptPriorityList.rankedList.forEach((promptElementKind: string) => {
    const snippetsFiltered = snippetsWithElementKind.filter(
      ({ kind: snippetKind }) => snippetKind === promptElementKind
    );
    sortSnippetsDescending(snippetsFiltered);
    allSnippets.push(...snippetsFiltered);
  });
  return allSnippets.slice(0, numberOfSnippets);
}

function processSnippetsForWishlist(
  snippets: Snippet[],
  targetDocLanguageId: string,
  tokenizer: ITokenizer,
  promptPriorityList: PromptPriorityList,
  totalPrioritized: number
): { announcedSnippet: string; provider: string; score: number; tokens: number; relativePath?: string }[] {
  const processedSnippets = selectSnippets(snippets, totalPrioritized, promptPriorityList)
    .map((snippet) => {
      const announced = announceSnippet(snippet, targetDocLanguageId);
      const tokens = tokenizer.tokenLength(announced);
      return {
        announcedSnippet: announced,
        provider: snippet.provider,
        score: snippet.score,
        tokens: tokens,
        relativePath: snippet.relativePath,
      };
    })
    .filter((snippet) => snippet.tokens > 0);
  sortSnippetsDescending(processedSnippets);
  processedSnippets.reverse();
  return processedSnippets;
}

export { processSnippetsForWishlist };
