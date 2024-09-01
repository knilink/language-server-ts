import { Snippet } from "../types.ts";
import { normalizeLanguageId } from "../prompt.ts";
import { newLineEnded, getPathMarker } from "../languageMarker.ts";
import { SnippetProvider, SnippetContext } from "./snippetProvider.ts";
// import { } from '../snippetInclusion/snippets'; // TODO

class PathSnippetProvider extends SnippetProvider {
  type = 'path';

  async buildSnippets(context: SnippetContext): Promise<Snippet[]> {
    const currentFile = context.currentFile;
    currentFile.languageId = normalizeLanguageId(currentFile.languageId);
    return [
      {
        provider: this.type,
        semantics: 'snippet',
        snippet: newLineEnded(getPathMarker(currentFile)),
        relativePath: currentFile.relativePath,
        startLine: 0,
        endLine: 0,
        score: 0,
      },
    ];
  }
}

export { PathSnippetProvider };
