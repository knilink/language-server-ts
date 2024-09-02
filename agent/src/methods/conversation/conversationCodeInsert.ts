import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';
import { type TextDocument } from '../../../../lib/src/textDocument.ts';

import { Context } from '../../../../lib/src/context.ts';
import { getTextDocumentChecked } from '../../textDocument.ts';
import {
  conversationSourceToUiKind,
  telemetryUserAction,
  telemetryPrefixForUiKind,
} from '../../../../lib/src/conversation/telemetry.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import { DocumentSchema, ConversationSourceSchema } from '../../../../lib/src/conversation/schema.ts';
import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { TelemetryMeasurements } from '../../../../lib/src/types.ts';

const Params = Type.Object({
  turnId: Type.String(),
  codeBlockIndex: Type.Number(),
  totalCharacters: Type.Number(),
  newFile: Type.Optional(Type.Boolean()),
  doc: Type.Optional(DocumentSchema),
  options: Type.Optional(TestingOptions),
  source: Type.Optional(ConversationSourceSchema),
});

async function handleConversationCodeInsertChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null] | [null, { code: number; message: string }]> {
  let textDocument: TextDocument | undefined;

  if (params.doc) {
    const result = await getTextDocumentChecked(ctx, params.doc.uri);

    if (result.status === 'notfound') return [null, { code: -32602, message: result.message }];
    if (result.status === 'valid') textDocument = result.document;
  }

  const measurements: TelemetryMeasurements = { totalCharacters: params.totalCharacters };
  if (textDocument && params.doc?.position) {
    measurements['cursorLocation'] = textDocument.offsetAt(params.doc.position);
  }

  const uiKind = conversationSourceToUiKind(params.source);
  telemetryUserAction(
    ctx,
    textDocument,
    {
      codeBlockIndex: params.codeBlockIndex.toString(),
      messageId: params.turnId,
      conversationId: ctx.get(Conversations).findByTurnId(params.turnId)?.id ?? '',
      newFile: `${params.newFile}`,
      uiKind: uiKind,
    },
    measurements,
    `${telemetryPrefixForUiKind(uiKind)}.acceptedInsert`
  );
  return ['OK', null];
}

const handleConversationCodeInsert = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationCodeInsertChecked)
);

export { handleConversationCodeInsert };
