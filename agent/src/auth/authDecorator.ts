import type { CancellationToken } from 'vscode-languageserver/node.js';

import { ResponseError } from 'vscode-languageserver/node.js';
import { ErrorCode } from '../rpc.ts';
import { Context } from '../../../lib/src/context.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';

type HandleFn<P, R> = (ctx: Context, token: CancellationToken, params: P) => Promise<R>;

async function verifyAuthenticated(ctx: Context, _token: CancellationToken): Promise<void> {
  const authResult = await ctx.get(AuthManager).checkAndUpdateStatus(ctx);
  if (authResult.status !== 'OK')
    throw new ResponseError(ErrorCode.NoCopilotToken, `Not authenticated: ${authResult.status}`);
}

function ensureAuthenticated<P, R>(handleFn: HandleFn<P, R>): HandleFn<P, R> {
  return async (ctx: Context, token: CancellationToken, params: P) => {
    await verifyAuthenticated(ctx, token);
    return handleFn(ctx, token, params);
  };
}

export { ensureAuthenticated, verifyAuthenticated };
