import type { LanguageId } from '../../../../prompt/src/types.ts';
import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';

import { Context } from '../../../../lib/src/context.ts';
import { TextDocumentManager } from '../../../../lib/src/textDocumentManager.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';

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
  const document = await ctx.get(TextDocumentManager).getTextDocument(params);
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
