import type { Context } from '../../../../lib/src/context.ts';

import { Type, type Static } from '@sinclair/typebox';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { EditConversations } from '../../../../lib/src/copilotEdits/services/editConversations.ts';
import { CancellationToken } from 'vscode-languageserver';

async function handleEditConversationDestroyChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.get(EditConversations).destroy(params.editConversationId);
  return ['OK', null];
}
const Params = Type.Object({ editConversationId: Type.String() });
const handleEditConversationDestroy = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleEditConversationDestroyChecked)
);

export { handleEditConversationDestroy };
