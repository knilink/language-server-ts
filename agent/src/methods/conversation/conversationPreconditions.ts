import { Type, type Static } from '@sinclair/typebox';

import { type Context } from '../../../../lib/src/context';
import { type CancellationToken } from '../../cancellation';

import { PreconditionsCheck } from '../../../../lib/src/conversation/preconditions';
import { TestingOptions } from '../testingOptions';
import { ensureAuthenticated } from '../../auth/authDecorator';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({
  options: Type.Optional(TestingOptions),
  forceCheck: Type.Optional(Type.Boolean()),
});

async function handleConversationPreconditionsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[Awaited<ReturnType<PreconditionsCheck['check']>>, null]> {
  const forceCheck = params.forceCheck ?? false;
  return [await ctx.get(PreconditionsCheck).check(forceCheck), null];
}

const handleConversationPreconditions = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationPreconditionsChecked)
);

export { Params, handleConversationPreconditions };
