import type { AuthRecord } from './types.ts';
import { type Context } from '../context.ts';

import { CopilotAuthError } from './error.ts';
import { editorVersionHeaders } from '../config.ts';
import { UserErrorNotifier } from '../error/userErrorNotifier.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { Fetcher, isNetworkError, type Request } from '../networking.ts';
import { telemetryGitHubLoginSuccess, telemetryNewGitHubLogin } from '../telemetry/auth.ts';

// ../../../agent/src/methods/signInInitiate.ts
type DeviceFlow = {
  device_code: string;
  expires_in: number; // seconds
  interval: number; // seconds
  user_code: string; // guess string for user to enter at verification_uri
  verification_uri: string;
};

async function requestDeviceFlowStage1(ctx: Context, clientId: string): Promise<DeviceFlow> {
  telemetryNewGitHubLogin(ctx, 'unknown', 'deviceFlow');
  const request: Request = {
    method: 'POST',
    headers: { Accept: 'application/json', ...editorVersionHeaders(ctx) },
    json: { client_id: clientId },
    timeout: 30_000,
  };
  let response;
  try {
    response = await ctx.get(Fetcher).fetch(ctx.get(NetworkConfiguration).getDeviceFlowStartUrl(), request);
  } catch (e) {
    if (e instanceof Error && isNetworkError(e)) {
      throw new CopilotAuthError(
        `Could not log in with device flow on ${ctx.get(NetworkConfiguration).getAuthAuthority()}: ${e.message}`
      );
    }
    throw e;
  }
  if (!response.ok) {
    throw new CopilotAuthError(
      `Could not log in with device flow on ${ctx.get(NetworkConfiguration).getAuthAuthority()}: HTTP ${response.status}`
    );
  }
  return response.json() as any;
}

async function requestDeviceFlowStage2(
  ctx: Context,
  deviceCode: string,
  clientId: string
): Promise<{ access_token?: string }> {
  const request: Request = {
    method: 'POST',
    headers: { Accept: 'application/json', ...editorVersionHeaders(ctx) },
    json: {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    },
    timeout: 30_000,
  };

  return (await (
    await ctx.get(Fetcher).fetch(ctx.get(NetworkConfiguration).getDeviceFlowCompletionUrl(), request)
  ).json()) as any;
}

async function requestUserInfo(ctx: Context, accessToken: string): Promise<{ login: string }> {
  telemetryGitHubLoginSuccess(ctx, 'deviceFlow');
  return (await (
    await ctx.get(Fetcher).fetch(ctx.get(NetworkConfiguration).getUserInfoUrl(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
  ).json()) as any;
}

export class GitHubDeviceFlow {
  async getToken(ctx: Context, clientId: string) {
    try {
      return await this.getTokenUnguarded(ctx, clientId);
    } catch (error) {
      ctx.get(UserErrorNotifier).notifyUser(ctx, error);
      throw error;
    }
  }

  async getTokenUnguarded(ctx: Context, clientId: string): Promise<DeviceFlow & { waitForAuth: Promise<AuthRecord> }> {
    const stage1 = await requestDeviceFlowStage1(ctx, clientId);
    const stage2Promise = (async (): Promise<AuthRecord> => {
      let expiresIn = stage1.expires_in;
      let accessToken;
      while (expiresIn > 0) {
        let stage2 = await requestDeviceFlowStage2(ctx, stage1.device_code, clientId);
        expiresIn -= stage1.interval;
        await new Promise((resolve) => setTimeout(resolve, 1000 * stage1.interval));
        accessToken = stage2.access_token;
        if (accessToken) {
          return { user: (await requestUserInfo(ctx, accessToken)).login, oauth_token: accessToken };
        }
      }
      throw new CopilotAuthError('Timed out waiting for login to complete');
    })();

    return { ...stage1, waitForAuth: stage2Promise };
  }
}
