import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';
import { Context } from '../../../../lib/src/context';
import { Conversations } from '../../../../lib/src/conversation/conversations';
import {
  conversationSourceToUiKind,
  telemetryUserAction,
  telemetryPrefixForUiKind,
} from '../../../../lib/src/conversation/telemetry';
import { TestingOptions } from '../testingOptions';
import { ConversationSourceSchema } from '../../../../lib/src/conversation/schema';
import { ensureAuthenticated } from '../../auth/authDecorator';
import { addMethodHandlerValidation } from '../../schemaValidation';

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
