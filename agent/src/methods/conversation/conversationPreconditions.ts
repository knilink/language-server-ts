import { Type, type Static } from '@sinclair/typebox';

import { type Context } from '../../../../lib/src/context.ts';

import { PreconditionsCheck } from '../../../../lib/src/conversation/preconditions.ts';
import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';

const Params = Type.Object({
  options: Type.Optional(TestingOptions),
  forceCheck: Type.Optional(Type.Boolean()),
});

async function handleConversationPreconditionsChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<[Awaited<ReturnType<PreconditionsCheck['check']>>, null]> {
  const forceCheck = params.forceCheck ?? false;
  return [await ctx.get(PreconditionsCheck).check(forceCheck), null];
}

const handleConversationPreconditions = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationPreconditionsChecked)
);

export { Params, handleConversationPreconditions };
