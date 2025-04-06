import type { Static } from '@sinclair/typebox';
import type { Context } from '../../../lib/src/context.ts';
import type { AuthRecord } from '../../../lib/src/auth/types.ts';

import { finishDeviceFlowCommand } from '../commands/auth.ts';
import { ErrorCode } from '../rpc.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { GitHubDeviceFlow } from '../../../lib/src/auth/deviceFlow.ts';
import { CopilotAuthError } from '../../../lib/src/auth/error.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { GitHubAppInfo } from '../../../lib/src/config.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({ options: Type.Optional(Type.Object({})), githubAppId: Type.Optional(Type.String()) });

async function handleSignInInitiateChecked(
  ctx: Context,
  token: unknown,
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
            command: { command: string; title: 'Sign in with GitHub'; arguments: [] };
          }
        | {
            status: 'AlreadySignedIn';
            user: string;
          }
      ),
      null,
    ]
  | [null, { code: number; message: string }]
> {
  try {
    let currentStatus = await ctx.get(AuthManager).checkAndUpdateStatus(ctx, { githubAppId: params.githubAppId });
    if (currentStatus.status === 'OK') return [{ status: 'AlreadySignedIn', user: currentStatus.user }, null];

    const appId = params.githubAppId ?? ctx.get(GitHubAppInfo).findAppIdToAuthenticate();
    const deviceFlow = await ctx.get(GitHubDeviceFlow).getToken(ctx, appId);

    const waitForAuth = deviceFlow.waitForAuth.then(async (authed: AuthRecord) => {
      ctx.get(GitHubAppInfo).githubAppId = appId;
      await ctx.get(AuthManager).setAuthRecord(ctx, { ...authed, githubAppId: appId });
      return await ctx.get(AuthManager).checkAndUpdateStatus(ctx, { freshSignIn: true });
    });

    ctx.get(AuthManager).pendingSignIn = { verificationUri: deviceFlow.verification_uri, status: waitForAuth };

    return [
      {
        status: 'PromptUserDeviceFlow',
        userCode: deviceFlow.user_code,
        verificationUri: deviceFlow.verification_uri,
        expiresIn: deviceFlow.expires_in,
        interval: deviceFlow.interval,
        command: { command: finishDeviceFlowCommand, title: 'Sign in with GitHub', arguments: [] },
      },
      null,
    ];
  } catch (e) {
    if (!(e instanceof CopilotAuthError)) throw e;
    return [null, { code: ErrorCode.DeviceFlowFailed, message: e.message }];
  }
}

const handleSignInInitiate = addMethodHandlerValidation(Params, handleSignInInitiateChecked);

export { handleSignInInitiate };
