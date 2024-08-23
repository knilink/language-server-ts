import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';
import { type Context } from '../../../../lib/src/context';
import { type TextDocument } from '../../../../lib/src/textDocument';
import { type TelemetryMeasurements } from '../../../../lib/src/types';

import { getTextDocumentChecked } from '../../textDocument';
import {
  conversationSourceToUiKind,
  telemetryUserAction,
  telemetryPrefixForUiKind,
} from '../../../../lib/src/conversation/telemetry';
import { Conversations } from '../../../../lib/src/conversation/conversations';
import { DocumentSchema, ConversationSourceSchema } from '../../../../lib/src/conversation/schema';
import { TestingOptions } from '../testingOptions';
import { ensureAuthenticated } from '../../auth/authDecorator';
import { addMethodHandlerValidation } from '../../schemaValidation';

enum CopyKind {
  Keyboard = 1,
  Toolbar = 2,
}

const Params = Type.Object({
  turnId: Type.String(),
  codeBlockIndex: Type.Number(),
  copyType: Type.Enum(CopyKind),
  copiedCharacters: Type.Number(),
  totalCharacters: Type.Number(),
  copiedText: Type.String(),
  doc: Type.Optional(DocumentSchema),
  options: Type.Optional(TestingOptions),
  source: Type.Optional(ConversationSourceSchema),
});

async function handleConversationCodeCopyChecked(
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

  const measurements: TelemetryMeasurements = {
    totalCharacters: params.totalCharacters,
    copiedCharacters: params.copiedCharacters,
  };
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
      copyType: params.copyType.toString(),
      uiKind: uiKind,
    },
    measurements,
    `${telemetryPrefixForUiKind(uiKind)}.acceptedCopy`
  );
  return ['OK', null];
}

const handleConversationCodeCopy = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationCodeCopyChecked)
);

export { handleConversationCodeCopy };
