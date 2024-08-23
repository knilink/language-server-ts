import { URI } from 'vscode-uri';

import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../cancellation';
import { type Context } from '../../../lib/src/context';

import { TextDocumentManager } from '../../../lib/src/textDocumentManager';
import { addMethodHandlerValidation } from '../schemaValidation';

const Params = Type.Object({
  source: Type.String(),
  version: Type.Number(),
  uri: Type.String(),
});

async function handleVerifyStateChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[{ status: boolean; message: string }, null]> {
  const document = await ctx.get(TextDocumentManager).getTextDocument(URI.parse(params.uri));

  if (document) {
    if (document.getText() !== params.source) {
      return [
        { status: false, message: `Source mismatch: [State] ${document.getText()} !== [Request] ${params.source}` },
        null,
      ];
    } else if (document.version !== params.version) {
      return [
        {
          status: false,
          message: `Version mismatch: [State] ${document.version} !== [Request] ${params.version}`,
        },
        null,
      ];
    } else {
      return [{ status: true, message: '' }, null];
    }
  } else {
    return [
      {
        status: false,
        message: `Document not found: "${URI.parse(params.uri)}" (given by the editor: "${params.uri}")`,
      },
      null,
    ];
  }
}

const handleVerifyState = addMethodHandlerValidation(Params, handleVerifyStateChecked);

export { handleVerifyState };
