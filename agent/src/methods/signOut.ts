import { Type, type Static } from '@sinclair/typebox';

import { Context } from '../../../lib/src/context.ts';
import { CancellationToken } from '../cancellation.ts';
import { AuthStatus } from '../../../lib/src/auth/types.ts';

import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';

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
