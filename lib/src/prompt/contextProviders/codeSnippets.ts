import type { LanguageId } from '../../types.ts';
import type { Context } from '../../context.ts';
import type { ContextItem, CodeSnippetType } from './contextItemSchemas.ts';

import { CodeSnippetWithIdSchema, filterContextItemsBySchema } from './contextItemSchemas.ts';
import { ContextProviderStatistics } from '../contextProviderStatistics.ts';
import { TextDocumentManager } from '../../textDocumentManager.ts';
import { CopilotTextDocument } from '../../textDocument.ts';
import { commentBlockAsSingles } from '../../../../prompt/src/languageMarker.ts';
import { normalizeLanguageId } from '../../../../prompt/src/prompt.ts';

async function getCodeSnippetsFromContextItems(
  ctx: Context,
  allContextItems: ContextItem[],
  languageId: LanguageId
): Promise<CodeSnippetType[]> {
  const result: CodeSnippetType[] = [];
  const matchedContextItems = allContextItems.filter((item) => item.matchScore > 0 && item.resolution !== 'error');
  const codeSnippetContextItems = filterContextItemsBySchema(matchedContextItems, CodeSnippetWithIdSchema);
  if (codeSnippetContextItems.length === 0) {
    return result;
  }
  const tdm = ctx.get(TextDocumentManager);
  const statistics = ctx.get(ContextProviderStatistics);
  const mappedSnippets = codeSnippetContextItems.flatMap((item) =>
    item.data.map((data) => ({ providerId: item.providerId, data }))
  );
  for (const snippet of mappedSnippets) {
    const contentExclusionPromises = [snippet.data.uri, ...(snippet.data.additionalUris ?? [])].map((uri) =>
      tdm.getTextDocumentWithValidation({ uri })
    );

    if ((await Promise.all(contentExclusionPromises)).every((r) => r.status === 'valid')) {
      result.push(snippet.data);
      statistics.addExpectations(snippet.providerId, [
        commentBlockAsSingles(snippet.data.value, normalizeLanguageId(languageId)),
      ]);
    } else {
      statistics.addExpectations(snippet.providerId, [CONTENT_EXCLUDED_EXPECTATION]);
    }
  }
  return result;
}

interface CodeSnippetWithRelativePath extends CodeSnippetType {
  relativePath?: string;
}

function addRelativePathToCodeSnippets(ctx: Context, codeSnippets: CodeSnippetType[]): CodeSnippetWithRelativePath[] {
  const tdm = ctx.get(TextDocumentManager);
  return codeSnippets.map((codeSnippet) => {
    const snippetDocument = CopilotTextDocument.create(codeSnippet.uri, 'unknown', 0, codeSnippet.value);
    return { ...codeSnippet, relativePath: tdm.getRelativePath(snippetDocument) };
  });
}

const CONTENT_EXCLUDED_EXPECTATION = 'content_excluded' as const;

export { CONTENT_EXCLUDED_EXPECTATION, addRelativePathToCodeSnippets, getCodeSnippetsFromContextItems };

export type { CodeSnippetWithRelativePath };
