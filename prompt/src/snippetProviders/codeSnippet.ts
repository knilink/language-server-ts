import type { DocumentUri } from 'vscode-languageserver-types';
import type { Snippet, SnippetContext, CodeSnippet } from '../types.ts';
import { SnippetProvider } from './snippetProvider.ts';
import { newLineEnded } from '../languageMarker.ts';
import type {} from '../snippetInclusion/snippets.ts';

class CodeSnippetProvider extends SnippetProvider {
  type: 'code' = 'code';

  async buildSnippets(context: SnippetContext): Promise<Snippet[]> {
    if (context.codeSnippets === undefined || context.codeSnippets.length === 0) {
      return [];
    }
    const { codeSnippets } = context;
    const snippetsByUri = new Map<DocumentUri, CodeSnippet[]>();
    for (const snippet of codeSnippets) {
      let uri = snippet.relativePath ?? snippet.uri;
      let snippets = snippetsByUri.get(uri);

      if (snippets === undefined) {
        snippets = [];
        snippetsByUri.set(uri, snippets);
      }

      snippets.push(snippet);
    }
    const result: Snippet[] = [];

    snippetsByUri.forEach((snippets: CodeSnippet[], uri: DocumentUri) => {
      let value = snippets.map((snippet) => snippet.value).join('\n---\n');
      result.push({
        provider: this.type,
        semantics: snippets.length > 1 ? 'snippets' : 'snippet',
        snippet: newLineEnded(value),
        relativePath: uri,
        startLine: 0,
        endLine: 0,
        score: Math.max(
          ...snippets.map((s) => {
            return s.importance ?? 0;
          })
        ),
      });
    });

    return result;
  }
}

export { CodeSnippetProvider };
