import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../cancellation';
import { AuthStatus } from '../../../lib/src/auth/types';

import { Context } from '../../../lib/src/context';
import { AuthManager } from '../../../lib/src/auth/manager';
import { addMethodHandlerValidation } from '../schemaValidation';

const Params = Type.Object({
  githubToken: Type.String({ minLength: 1 }),
  user: Type.String({ minLength: 1 }),
  githubAppId: Type.Optional(Type.String({ minLength: 1 })),
});

async function handleSignInWithGithubTokenChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[AuthStatus, null]> {
  const githubToken = params.githubToken;
  const githubUser = params.user;
  const githubAppId = params.githubAppId;

  await ctx.get(AuthManager).setAuthRecord(ctx, { user: githubUser, oauth_token: githubToken, githubAppId });
  return [await ctx.get(AuthManager).checkAndUpdateStatus(ctx), null];
}

const handleSignInWithGithubToken = addMethodHandlerValidation(Params, handleSignInWithGithubTokenChecked);

export { Params, handleSignInWithGithubToken };
