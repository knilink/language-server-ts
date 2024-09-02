import { commentBlockAsSingles } from './languageMarker.ts';
import { Document, Snippet } from './types.ts';

function announceTooltipSignatureSnippet(snippet: string, targetDocLanguageId: string): string {
  const formattedSnippet = `Use ${snippet}`;
  return commentBlockAsSingles(formattedSnippet, targetDocLanguageId);
}

function endsWithAttributesOrMethod(doc: Document): boolean {
  const directContext = doc.source.substring(0, doc.offset);
  return regexAttributeOrMethod.test(directContext);
}

function transferLastLineToTooltipSignature(
  directContext: string,
  tooltipSignatureSnippet: Snippet
): [string, Snippet] {
  const lastLineStart = directContext.lastIndexOf('\n') + 1;
  const directContextBeforePartialLastLine = directContext.substring(0, lastLineStart);
  const partialLastLine = directContext.substring(lastLineStart);

  tooltipSignatureSnippet.snippet += partialLastLine; // MARK: mutate
  return [directContextBeforePartialLastLine, tooltipSignatureSnippet];
}

const regexAttributeOrMethod = /(\.|\->|::)\w+$/;

export { announceTooltipSignatureSnippet, endsWithAttributesOrMethod, transferLastLineToTooltipSignature };
