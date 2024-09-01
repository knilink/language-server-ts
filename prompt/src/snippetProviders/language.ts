import { SnippetContext, Snippet } from "../types.ts";
import { SnippetProvider } from "./snippetProvider.ts";
// import { } from '../snippetInclusion/snippets';
import { normalizeLanguageId } from "../prompt.ts";
import { getLanguageMarker, newLineEnded } from "../languageMarker.ts";

class LanguageSnippetProvider extends SnippetProvider {
  type = 'language';

  async buildSnippets(context: SnippetContext): Promise<Snippet[]> {
    const { currentFile } = context;
    currentFile.languageId = normalizeLanguageId(currentFile.languageId); // mutate
    return [
      {
        provider: this.type,
        semantics: 'snippet',
        snippet: newLineEnded(getLanguageMarker(currentFile)),
        relativePath: currentFile.relativePath,
        startLine: 0,
        endLine: 0,
        score: 0,
      },
    ];
  }
}

export { LanguageSnippetProvider };
