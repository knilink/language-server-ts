import type { CancellationToken } from 'vscode-languageserver';
import type { Context } from '../../../../lib/src/context.ts';

import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { ConversationSourceSchema } from '../../../../lib/src/conversation/schema.ts';
import {
  createTelemetryWithExpWithId,
  telemetryPrefixForUiKind,
  telemetryUserAction,
} from '../../../../lib/src/conversation/telemetry.ts';
import { EditConversations } from '../../../../lib/src/copilotEdits/services/editConversations.ts';
import { Type, type Static } from '@sinclair/typebox';
import type {} from '../../../../lib/src/openai/fetch.ts';

async function handleEditConversationTurnDeleteChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.get(EditConversations).deleteTurn(params.editConversationId, params.editTurnId);
  let telemetryWithExp = await createTelemetryWithExpWithId(ctx, params.editTurnId, params.editConversationId, {
    languageId: '',
  });
  telemetryUserAction(
    ctx,
    undefined,
    { messageId: params.editTurnId, uiKind: 'editsPanel', conversationId: params.editConversationId },
    {},
    `${telemetryPrefixForUiKind('editsPanel')}.copilotEditsMessageDelete`,
    telemetryWithExp
  );
  return ['OK', null];
}

const Params = Type.Object({
  editConversationId: Type.String(),
  editTurnId: Type.String(),
  options: Type.Optional(TestingOptions),
  source: Type.Optional(ConversationSourceSchema),
});

const handleEditConversationTurnDelete = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleEditConversationTurnDeleteChecked)
);

export { handleEditConversationTurnDelete };
