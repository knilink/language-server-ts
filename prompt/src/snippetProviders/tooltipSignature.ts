import { Document, Snippet } from "../types.ts";
import { normalizeLanguageId } from "../prompt.ts";
import { newLineEnded } from "../languageMarker.ts";
import { announceTooltipSignatureSnippet, endsWithAttributesOrMethod } from "../tooltipSignature.ts";
import { SnippetProvider } from "./snippetProvider.ts";
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
