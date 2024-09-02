import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';

import { Context } from '../../../../lib/src/context.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';

const Params = Type.Object({ conversationId: Type.String(), options: Type.Optional(TestingOptions) });

async function handleConversationDestroyChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.get(Conversations).destroy(params.conversationId);
  return ['OK', null];
}

const handleConversationDestroy = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationDestroyChecked)
);

export { handleConversationDestroy };
