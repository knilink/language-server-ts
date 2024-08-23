import { Type, type Static } from '@sinclair/typebox';

import { type CancellationToken } from '../../cancellation';
import { type Context } from '../../../../lib/src/context';

import { PersistenceManager } from '../../../../lib/src/persist';
import { TestingOptions } from '../testingOptions';
import { ensureAuthenticated } from '../../auth/authDecorator';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({ options: Type.Optional(TestingOptions) });

async function handleConversationPersistenceChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[{ path: string }, null]> {
  return [{ path: ctx.get(PersistenceManager).directory }, null];
}

const handleConversationPersistence = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationPersistenceChecked)
);

export { handleConversationPersistence };
