import { Type, type Static } from '@sinclair/typebox';
import type { CancellationToken } from '../cancellation.ts';
import type { Context } from '../../../lib/src/context.ts';

import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { AuthStatus } from '../../../lib/src/auth/types.ts';

const Params = Type.Object({ options: Type.Optional(Type.Object({})) });

async function handleSignInConfirmChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[AuthStatus, null] | [null, { code: number; message: string }]> {
  const pendingSignIn = ctx.get(AuthManager).getPendingSignIn();
  if (pendingSignIn === undefined) return [null, { code: -32600, message: 'No pending sign in' }];
  try {
    return [await pendingSignIn, null];
  } catch (err: any) {
    return [null, { code: 1001, message: err.toString() }];
  } finally {
    ctx.get(AuthManager).setPendingSignIn(undefined);
  }
}

const handleSignInConfirm = addMethodHandlerValidation(Params, handleSignInConfirmChecked);

export { handleSignInConfirm };
