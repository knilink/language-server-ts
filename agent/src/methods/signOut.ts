import { Type, type Static } from '@sinclair/typebox';

import { Context } from '../../../lib/src/context';
import { CancellationToken } from '../cancellation';
import { AuthStatus } from '../../../lib/src/auth/types';

import { AuthManager } from '../../../lib/src/auth/manager';
import { addMethodHandlerValidation } from '../schemaValidation';

const Params = Type.Object({ options: Type.Optional(Type.Object({})) });

async function handleSignOutChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[AuthStatus, null]> {
  await ctx.get(AuthManager).deleteAuthRecord(ctx);
  return [await ctx.get(AuthManager).checkAndUpdateStatus(ctx), null];
}

const handleSignOut = addMethodHandlerValidation(Params, handleSignOutChecked);

export { Params, handleSignOut };
