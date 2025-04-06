import type { Static } from '@sinclair/typebox';
import type { Context } from '../../../lib/src/context.ts';
import type { AuthStatus } from '../../../lib/src/auth/types.ts';

import { ErrorCode } from '../rpc.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({ options: Type.Optional(Type.Object({})) });

async function handleSignInConfirmChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<[AuthStatus, null] | [null, { code: number; message: string }]> {
  const pendingSignIn = ctx.get(AuthManager).pendingSignIn?.status;
  if (pendingSignIn === undefined) return [null, { code: ErrorCode.InvalidRequest, message: 'No pending sign in' }];
  try {
    return [await pendingSignIn, null];
  } catch (err: any) {
    return [null, { code: ErrorCode.DeviceFlowFailed, message: String(err) }];
  } finally {
    ctx.get(AuthManager).pendingSignIn = undefined;
  }
}

const handleSignInConfirm = addMethodHandlerValidation(Params, handleSignInConfirmChecked);

export { handleSignInConfirm };
