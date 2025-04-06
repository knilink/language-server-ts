import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';
import type { CopilotTextDocument } from '../../../../lib/src/textDocument.ts';

import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { ErrorCode } from '../../rpc.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { getTextDocumentChecked } from '../../textDocument.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import { ConversationSourceSchema, DocumentSchema } from '../../../../lib/src/conversation/schema.ts';
import {
  conversationSourceToUiKind,
  createTelemetryWithExpWithId,
  telemetryPrefixForUiKind,
  telemetryUserAction,
} from '../../../../lib/src/conversation/telemetry.ts';
import { Type } from '@sinclair/typebox';

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
  let textDocument: CopilotTextDocument | undefined;
  if (params.doc) {
    const result = await getTextDocumentChecked(ctx, params.doc.uri);
    if (result.status === 'notfound') return [null, { code: ErrorCode.InvalidParams, message: result.message }];
    if (result.status === 'valid') textDocument = result.document;
  }

  const uiKind = conversationSourceToUiKind(params.source);
  const rating = params.rating > 0 ? 'positive' : params.rating < 0 ? 'negative' : 'unrated';

  const conversationId = ctx.get(Conversations).findByTurnId(params.turnId)?.id ?? '';

  const telemetryWithExp = await createTelemetryWithExpWithId(
    ctx,
    params.turnId,
    ctx.get(Conversations).findByTurnId(params.turnId)?.id ?? '',
    { languageId: textDocument?.languageId ?? '' }
  );

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
    `${telemetryPrefixForUiKind(uiKind)}.messageRating`,
    telemetryWithExp
  );
  return ['OK', null];
}

const handleConversationRating = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationRatingChecked)
);

export { handleConversationRating };
