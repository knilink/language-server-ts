import { Snippet } from '../types';
import { normalizeLanguageId } from '../prompt';
import { newLineEnded, getPathMarker } from '../languageMarker';
import { SnippetProvider, SnippetContext } from './snippetProvider';
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
