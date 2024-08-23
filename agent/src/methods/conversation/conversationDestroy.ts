import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';

import { Context } from '../../../../lib/src/context';
import { Conversations } from '../../../../lib/src/conversation/conversations';
import { TestingOptions } from '../testingOptions';
import { ensureAuthenticated } from '../../auth/authDecorator';
import { addMethodHandlerValidation } from '../../schemaValidation';

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
