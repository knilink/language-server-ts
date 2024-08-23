import { Document, Snippet } from '../types';
import { normalizeLanguageId } from '../prompt';
import { newLineEnded } from '../languageMarker';
import { announceTooltipSignatureSnippet, endsWithAttributesOrMethod } from '../tooltipSignature';
import { SnippetProvider } from './snippetProvider';
// import { } from '../snippetInclusion/snippets'; // circular // TODO unused

class TooltipSignatureSnippetProvider extends SnippetProvider {
  type = 'tooltip-signature';

  async buildSnippets(context: { currentFile: Document; tooltipSignature?: string }): Promise<Snippet[]> {
    const { currentFile, tooltipSignature } = context;
    let snippets: Snippet[] = [];

    currentFile.languageId = normalizeLanguageId(currentFile.languageId);

    if (tooltipSignature && endsWithAttributesOrMethod(currentFile)) {
      snippets.push({
        provider: this.type,
        semantics: 'snippet',
        snippet: newLineEnded(announceTooltipSignatureSnippet(tooltipSignature, currentFile.languageId)),
        relativePath: currentFile.relativePath,
        startLine: 0,
        endLine: 0,
        score: 0,
      });
    }

    return snippets;
  }
}

export { TooltipSignatureSnippetProvider };
