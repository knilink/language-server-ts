import { Type, type Static } from '@sinclair/typebox';
import { Context } from '../../../../lib/src/context.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import {
  conversationSourceToUiKind,
  createTelemetryWithExpWithId,
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
  token: unknown,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.get(Conversations).deleteTurn(params.conversationId, params.turnId);
  const uiKind = conversationSourceToUiKind(params.source);
  const telemetryWithExp = await createTelemetryWithExpWithId(
    ctx,
    params.turnId,
    ctx.get(Conversations).findByTurnId(params.turnId)?.id ?? '',
    { languageId: '' }
  );

  telemetryUserAction(
    ctx,
    undefined,
    { messageId: params.turnId, uiKind: uiKind, conversationId: params.conversationId },
    {},
    `${telemetryPrefixForUiKind(uiKind)}.messageDelete`,
    telemetryWithExp
  );

  return ['OK', null];
}

const handleConversationTurnDelete = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationTurnDeleteChecked)
);

export { handleConversationTurnDelete };
