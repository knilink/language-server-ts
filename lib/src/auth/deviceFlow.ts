import { type Context } from '../context';

import { telemetryNewGitHubLogin, telemetryGitHubLoginSuccess, telemetryGitHubLoginFailed } from '../telemetry/auth';
import { editorVersionHeaders } from '../config';
import { Fetcher, isNetworkError, type Request } from '../networking';
import { NetworkConfiguration } from '../networkConfiguration';
import { UserErrorNotifier } from '../error/userErrorNotifier';
import { CopilotAuthError } from './error';
import { AuthRecord } from './types';

// ../../../../agent/src/methods/signInInitiate.ts
type DeviceFlow = {
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: unknown;
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
  const r = await ctx.get(Fetcher).fetch(ctx.get(NetworkConfiguration).getDeviceFlowCompletionUrl(), request);
  return r.json() as any;
}

async function requestUserInfo(ctx: Context, accessToken: string): Promise<{ login: string }> {
  telemetryGitHubLoginSuccess(ctx, 'deviceFlow');
  const fetcher = ctx.get(Fetcher);
  const userInfoUrl = ctx.get(NetworkConfiguration).getUserInfoUrl();
  const r = await fetcher.fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  return r.json() as any;
}

export class GitHubDeviceFlow {
  async getToken(ctx: Context, clientId: string) {
    try {
      return await this.getTokenUnguarded(ctx, clientId);
    } catch (error) {
      telemetryGitHubLoginFailed(ctx);
      ctx.get(UserErrorNotifier).notifyUser(ctx, error);
      throw error;
    }
  }

  async getTokenUnguarded(ctx: Context, clientId: string): Promise<DeviceFlow & { waitForAuth: Promise<AuthRecord> }> {
    const stage1 = await requestDeviceFlowStage1(ctx, clientId);
    const stage2Promise = new Promise<AuthRecord>(async (resolve, reject) => {
      let expiresIn = stage1.expires_in;
      let accessToken: string | undefined;
      while (expiresIn > 0) {
        const stage2 = await requestDeviceFlowStage2(ctx, stage1.device_code, clientId);
        expiresIn -= stage1.interval;
        await new Promise((resolve) => setTimeout(resolve, 1000 * stage1.interval));
        accessToken = stage2.access_token;
        if (accessToken) {
          let userInfo = await requestUserInfo(ctx, accessToken);
          resolve({ user: userInfo.login, oauth_token: accessToken });
          return;
        }
      }
      reject(new CopilotAuthError('Timed out waiting for login to complete'));
    });

    return { ...stage1, waitForAuth: stage2Promise };
  }
}
