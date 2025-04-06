import { Type } from '@sinclair/typebox';

import { type Context } from '../../../lib/src/context.ts';
import { type AuthStatus } from '../../../lib/src/auth/types.ts';

import { TestingOptions } from './testingOptions.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';

const Params = Type.Object({
  options: Type.Optional(
    Type.Intersect([
      Type.Object({
        localChecksOnly: Type.Optional(Type.Boolean()),
        forceRefresh: Type.Optional(Type.Boolean()),
      }),
      TestingOptions,
    ])
  ),
});

async function handleCheckStatusChecked(
  ctx: Context,
  token: unknown,
  params: { options?: any }
): Promise<[AuthStatus, null]> {
  return [await ctx.get(AuthManager).checkAndUpdateStatus(ctx, params.options), null];
}

const handleCheckStatus = addMethodHandlerValidation(Params, handleCheckStatusChecked);

export { handleCheckStatus };
