import type { Context } from '../../context.ts';
import type { CopilotFunctionComponent } from '../jsxTypes.ts';
import type { CodeSnippetWithRelativePath } from '../contextProviders/codeSnippets.ts';
import type { CodeSnippetType } from '../contextProviders/contextItemSchemas.ts';

import { isCompletionRequestData } from './completionsPrompt.tsx';
import { addRelativePathToCodeSnippets } from '../contextProviders/codeSnippets.ts';
import { Text } from '../../../../prompt/src/components/components.ts';
import { commentBlockAsSingles, newLineEnded } from '../../../../prompt/src/languageMarker.ts';
import { normalizeLanguageId } from '../../../../prompt/src/prompt.ts';
import type {} from '../../../../prompt/src/lib.ts';
import { CopilotTextDocument } from '../../textDocument.ts';

interface CodeSnippetsProps {
  ctx: Context;
  // completionsPrompt.tsx
  weight: number;
}

interface RawSnippet {
  // ../contextProviders/contextItemSchemas.ts
  id?: string;
  value: string;
}

interface RawCodeSnippet {
  rawSnippets: RawSnippet[];
  importance: number;
}

const CodeSnippets: CopilotFunctionComponent<CodeSnippetsProps> = (props, context) => {
  const [snippets, setSnippets] = context.useState<CodeSnippetType[] | undefined>();
  const [document, setDocument] = context.useState<CopilotTextDocument>();

  context.useData(isCompletionRequestData, (request) => {
    if (request.codeSnippets !== snippets) {
      setSnippets(request.codeSnippets);
    }

    if (request.document.uri !== document?.uri) {
      setDocument(request.document);
    }
  });

  if (!snippets || snippets.length === 0 || !document) {
    return;
  }
  const languageId = normalizeLanguageId(document.clientLanguageId);
  const codeSnippetsWithRelativePath = addRelativePathToCodeSnippets(props.ctx, snippets);
  const snippetsByUri = new Map<string, CodeSnippetWithRelativePath[]>();
  for (const snippet of codeSnippetsWithRelativePath) {
    const uri = snippet.relativePath ?? snippet.uri;
    let groupedSnippets = snippetsByUri.get(uri);

    if (groupedSnippets === undefined) {
      groupedSnippets = [];
      snippetsByUri.set(uri, groupedSnippets);
    }

    groupedSnippets.push(snippet);
  }

  const rawCodeSnippets = [];

  for (const [uri, snippets] of snippetsByUri) {
    const validSnippets = snippets.filter((s) => s.value.length > 0);
    if (validSnippets.length > 0) {
      const rawSnippets: RawSnippet[] = [];
      const semantics = validSnippets.length > 1 ? 'these snippets' : 'this snippet';
      validSnippets.forEach((snippet, index) => {
        const blockHeader = index === 0 ? `Compare ${semantics} from ${uri}:\n` : '';

        const blockFooter = validSnippets.length > 1 && index < validSnippets.length - 1 ? '\n---\n' : '';

        let blockValue = blockHeader + newLineEnded(snippet.value) + blockFooter;
        rawSnippets.push({ id: snippet.id, value: commentBlockAsSingles(blockValue, languageId) });
      });
      const importance = Math.max(
        ...validSnippets.map((s) => {
          return s.importance ?? 0;
        })
      );
      rawCodeSnippets.push({ rawSnippets, importance });
    }
  }

  if (rawCodeSnippets.length !== 0) {
    rawCodeSnippets.sort((a, b) => b.importance - a.importance);
    rawCodeSnippets.reverse();
    return (
      <>
        {rawCodeSnippets
          .flatMap((cs) => cs.rawSnippets)
          .map((rs) => (
            <Text key={rs.id}>{rs.value}</Text>
          ))}
      </>
    );
  }
};

export { CodeSnippets };
