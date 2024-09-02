import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';
import { Context } from '../../../../lib/src/context.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import {
  conversationSourceToUiKind,
  telemetryUserAction,
  telemetryPrefixForUiKind,
} from '../../../../lib/src/conversation/telemetry.ts';
import { TestingOptions } from '../testingOptions.ts';
import { ConversationSourceSchema } from '../../../../lib/src/conversation/schema.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';

const Params = Type.Object({
  conversationId: Type.String(),
  turnId: Type.String(),
  options: Type.Optional(TestingOptions),
  source: Type.Optional(ConversationSourceSchema),
});

async function handleConversationTurnDeleteChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.get(Conversations).deleteTurn(params.conversationId, params.turnId);
  const uiKind = conversationSourceToUiKind(params.source);

  telemetryUserAction(
    ctx,
    undefined,
    { messageId: params.turnId, uiKind: uiKind, conversationId: params.conversationId },
    {},
    `${telemetryPrefixForUiKind(uiKind)}.messageDelete`
  );

  return ['OK', null];
}

const handleConversationTurnDelete = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationTurnDeleteChecked)
);

export { handleConversationTurnDelete };
