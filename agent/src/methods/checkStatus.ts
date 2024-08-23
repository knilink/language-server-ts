import { Type } from '@sinclair/typebox';

import { type CancellationToken } from '../cancellation';
import { type Context } from '../../../lib/src/context';
import { type AuthStatus } from '../../../lib/src/auth/types';

import { TestingOptions } from './testingOptions';
import { AuthManager } from '../../../lib/src/auth/manager';
import { addMethodHandlerValidation } from '../schemaValidation';

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
  token: CancellationToken,
  params: { options?: any }
): Promise<[AuthStatus, null]> {
  return [await ctx.get(AuthManager).checkAndUpdateStatus(ctx, params.options), null];
}

const handleCheckStatus = addMethodHandlerValidation(Params, handleCheckStatusChecked);

export { handleCheckStatus };
