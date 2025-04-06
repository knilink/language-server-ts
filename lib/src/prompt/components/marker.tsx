import type { CurrentDocument } from '../../../../prompt/src/types.ts';
import type { CopilotFunctionComponent } from '../jsxTypes.ts';
import type { Context } from '../../context.ts';
import type { CopilotTextDocument } from '../../textDocument.ts';

import { isCompletionRequestData } from './completionsPrompt.tsx';
import { TextDocumentManager } from '../../textDocumentManager.ts';
import { Text } from '../../../../prompt/src/components/components.ts';
import { getLanguageMarker, getPathMarker } from '../../../../prompt/src/languageMarker.ts';

const DocumentMarker: CopilotFunctionComponent<{ ctx: Context; weight: number }> = (props, context) => {
  const [document, setDocument] = context.useState<CopilotTextDocument>();

  context.useData(isCompletionRequestData, (request) => {
    if (request.document.uri !== document?.uri) {
      setDocument(request.document);
    }
  });

  if (document) {
    const tdm = props.ctx.get(TextDocumentManager);
    const relativePath = tdm.getRelativePath(document);
    const docInfo: CurrentDocument = {
      uri: document.uri,
      source: document.getText(),
      offset: -1,
      relativePath,
      languageId: document.detectedLanguageId,
    };
    const notebook = tdm.findNotebook(document);
    return docInfo.relativePath && !notebook ? <PathMarker docInfo={docInfo} /> : <LanguageMarker docInfo={docInfo} />;
  }
};

const PathMarker: CopilotFunctionComponent<{ docInfo: CurrentDocument }> = (props, context) => (
  <Text>{getPathMarker(props.docInfo)}</Text>
);

const LanguageMarker: CopilotFunctionComponent<{ docInfo: CurrentDocument }> = (props, context) => (
  <Text>{getLanguageMarker(props.docInfo)}</Text>
);

export { DocumentMarker };
