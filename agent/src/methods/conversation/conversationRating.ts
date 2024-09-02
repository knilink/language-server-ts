import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';

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
import { TextDocument } from '../../../../lib/src/textDocument.ts';

const Params = Type.Object({
  turnId: Type.String(),
  rating: Type.Number(),
  doc: Type.Optional(DocumentSchema),
  options: Type.Optional(TestingOptions),
  source: Type.Optional(ConversationSourceSchema),
});

async function handleConversationRatingChecked(
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

  const uiKind = conversationSourceToUiKind(params.source);
  const rating = params.rating > 0 ? 'positive' : params.rating < 0 ? 'negative' : 'unrated';

  const conversationId = ctx.get(Conversations).findByTurnId(params.turnId)?.id ?? '';

  return (
    telemetryUserAction(
      ctx,
      textDocument,
      {
        rating,
        messageId: params.turnId,
        conversationId,
        uiKind,
      },
      {},
      `${telemetryPrefixForUiKind(uiKind)}.messageRating`
    ),
    ['OK', null]
  );
}

const handleConversationRating = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationRatingChecked)
);

export { handleConversationRating };
