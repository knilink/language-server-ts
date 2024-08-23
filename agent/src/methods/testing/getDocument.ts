import { URI } from 'vscode-uri';

import type { LanguageId } from '../../../../prompt/src/types';
import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';

import { Context } from '../../../../lib/src/context';
import { TextDocumentManager } from '../../../../lib/src/textDocumentManager';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({ uri: Type.String() });

type Document = {
  uri: string;
  languageId: LanguageId;
  version: number;
  text: string;
};

async function handleGetDocumentChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[Document, null]> {
  const document = await ctx.get(TextDocumentManager).getTextDocument(URI.parse(params.uri));
  return [
    {
      uri: params.uri,
      languageId: document?.languageId ?? 'unknown',
      version: document?.version ?? -1,
      text: document?.getText() ?? '',
    },
    null,
  ];
}

const handleGetDocument = addMethodHandlerValidation(Params, handleGetDocumentChecked);

export { handleGetDocument };
