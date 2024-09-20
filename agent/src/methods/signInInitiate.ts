import { Type, type Static } from '@sinclair/typebox';
import { type Context } from '../../../lib/src/context.ts';
import { type CancellationToken } from '../cancellation.ts';
import { type AuthRecord } from '../../../lib/src/auth/types.ts';

import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { GitHubAppInfo } from '../../../lib/src/config.ts';
import { GitHubDeviceFlow } from '../../../lib/src/auth/deviceFlow.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { CopilotAuthError } from '../../../lib/src/auth/error.ts';

const Params = Type.Object({ options: Type.Optional(Type.Object({})), githubAppId: Type.Optional(Type.String()) });

async function handleSignInInitiateChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<
  | [
      (
        | {
            status: 'PromptUserDeviceFlow';
            userCode: string;
            expiresIn: number;
            interval: number;
            verificationUri: string;
          }
        | {
            status: 'AlreadySignedIn';
            user?: string;
          }
      ),
      null,
    ]
  | [null, { code: number; message: string }]
> {
  try {
    let currentStatus = await ctx.get(AuthManager).checkAndUpdateStatus(ctx);
    if (currentStatus.status === 'OK') return [{ status: 'AlreadySignedIn', user: currentStatus.user }, null];

    const appId = ctx.get(GitHubAppInfo).findAppIdToAuthenticate();
    const deviceFlow = await ctx.get(GitHubDeviceFlow).getToken(ctx, appId);

    const waitForAuth = deviceFlow.waitForAuth.then(async (authed: AuthRecord) => {
      await ctx.get(AuthManager).setAuthRecord(ctx, { ...authed, githubAppId: appId });
      return await ctx.get(AuthManager).checkAndUpdateStatus(ctx);
    });

    ctx.get(AuthManager).setPendingSignIn(waitForAuth);

    return [
      {
        status: 'PromptUserDeviceFlow',
        userCode: deviceFlow.user_code,
        verificationUri: deviceFlow.verification_uri,
        expiresIn: deviceFlow.expires_in,
        interval: deviceFlow.interval,
      },
      null,
    ];
  } catch (e) {
    if (!(e instanceof CopilotAuthError)) throw e;
    return [null, { code: 1001, message: (e as any).message }];
  }
}

const handleSignInInitiate = addMethodHandlerValidation(Params, handleSignInInitiateChecked);

export { handleSignInInitiate };
