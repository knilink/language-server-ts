import { Type, type Static } from '@sinclair/typebox';

import { type Context } from '../../../../lib/src/context.ts';

import { PersistenceManager } from '../../../../lib/src/persist.ts';
import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';

const Params = Type.Object({ options: Type.Optional(TestingOptions) });

async function handleConversationPersistenceChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<[{ path: string }, null]> {
  return [{ path: ctx.get(PersistenceManager).directory }, null];
}

const handleConversationPersistence = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationPersistenceChecked)
);

export { handleConversationPersistence };
