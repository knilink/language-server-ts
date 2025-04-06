import type { GitHubToken, AuthStatus, AuthRecord, PendingSignIn } from './types.ts';
// import { getBuildType } from '../config.ts';
//
import type { Context } from '../context.ts'; // replace with actual import path if exists
import type { AuthPersistence } from './authPersistence.ts'; // replace with actual import path if exists
import type { CopilotTokenManager } from './copilotTokenManager.ts'; // replace with actual import path if exists

import { TokenResultError } from './copilotTokenManager.ts';
import { authLogger } from './copilotToken.ts';
import { editorVersionHeaders, getBuildType } from '../config.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { Fetcher } from '../networking.ts';
import { TelemetryInitialization } from '../telemetry/setupTelemetryReporters.ts';

function getAuthRecordFromEnv(env: Record<string, string | undefined>): AuthRecord | undefined {
  if (env.GH_COPILOT_TOKEN && !/=/.test(env.GH_COPILOT_TOKEN)) {
    return { user: '<environment-variable-user>', oauth_token: env.GH_COPILOT_TOKEN };
  }
  if (env.GITHUB_COPILOT_TOKEN) {
    return { user: '<environment-variable-user>', oauth_token: env.GITHUB_COPILOT_TOKEN };
  }
  if (env.CODESPACES === 'true' && env.GITHUB_TOKEN) {
    return { user: env.GITHUB_USER || '<codespaces-user>', oauth_token: env.GITHUB_TOKEN };
  }
}

class AuthManager {
  _copilotTokenManager: CopilotTokenManager;
  private _transientAuthRecord?:
    | AuthRecord
    // ../../../agent/src/service.ts
    | null;

  pendingSignIn?: PendingSignIn;

  constructor(
    readonly authPersistence: AuthPersistence,
    copilotTokenManager: CopilotTokenManager
  ) {
    this._copilotTokenManager = copilotTokenManager;
  }

  getCopilotTokenManager(): CopilotTokenManager {
    return this._copilotTokenManager;
  }

  async checkAndUpdateStatus(
    ctx: Context,
    options?: { localChecksOnly?: boolean; forceRefresh?: boolean; githubAppId?: string; freshSignIn?: boolean }
  ): Promise<AuthStatus> {
    const localChecksOnly = options?.localChecksOnly ?? false;
    let authRecord = getAuthRecordFromEnv(process.env);

    if (authRecord === undefined) {
      authRecord = await this.getAuthRecord(options?.githubAppId);
    }

    if (authRecord === undefined) {
      this._copilotTokenManager.resetToken();
      return { status: 'NotSignedIn' };
    }

    if (localChecksOnly) {
      return { status: 'MaybeOK', user: authRecord.user };
    }

    if (options?.forceRefresh) {
      this._copilotTokenManager.resetToken();
    }

    return {
      status: await this.getTokenWithSignUpLimited(ctx, authRecord, options?.freshSignIn ?? false),
      user: authRecord.user,
    };
  }

  async getAuthRecord(githubAppId?: string): Promise<AuthRecord | undefined> {
    // skip when set as null at ../../../agent/src/service.ts
    if (this._transientAuthRecord === null) return;
    // getPersistedAuthRecord when _transientAuthRecord is undefined
    return this._transientAuthRecord ?? this.getPersistedAuthRecord(githubAppId);
  }

  async getTokenWithSignUpLimited(
    ctx: Context,
    authRecord: AuthRecord,
    freshSignIn: boolean
  ): Promise<'OK' | 'NotSignedIn'> {
    try {
      await this._copilotTokenManager.getToken();
    } catch (e) {
      if (e instanceof TokenResultError) {
        if (freshSignIn && e.result.envelope?.can_signup_for_limited && (await this.signUpLimited(ctx, authRecord))) {
          return this.getTokenWithSignUpLimited(ctx, authRecord, false);
        }
        if (e.result.reason === 'HTTP401') {
          return 'NotSignedIn';
        }
        return e.result.reason as any; // TODO tmp workaournd
      }
      throw e;
    }
    return 'OK';
  }

  async getPersistedAuthRecord(githubAppId?: string): Promise<AuthRecord | undefined> {
    return await this.authPersistence.getAuthRecord(githubAppId);
  }

  async getGitHubToken(ctx: Context): Promise<GitHubToken | undefined> {
    const authRecord = getAuthRecordFromEnv(process.env) ?? (await this.getAuthRecord());

    if (authRecord === undefined) {
      return;
    }

    let gitHubToken: GitHubToken = { token: authRecord.oauth_token };

    if (authRecord.dev_override && getBuildType(ctx) === 'dev') {
      gitHubToken.devOverride = {
        copilotTokenUrl: authRecord.dev_override.copilot_token,
        notificationUrl: authRecord.dev_override.notification,
        contentRestrictionsUrl: authRecord.dev_override.content_restrictions,
      };
    }

    return gitHubToken;
  }

  async signUpLimited(ctx: Context, authRecord: AuthRecord) {
    const signUpLimitedUrl = ctx.get(NetworkConfiguration).getSignUpLimitedUrl();
    try {
      const signUpLimitedResult = await (
        await ctx.get(Fetcher).fetch(signUpLimitedUrl, {
          headers: { Authorization: `token ${authRecord.oauth_token}`, ...editorVersionHeaders(ctx) },
          method: 'POST',
          body: JSON.stringify({
            restricted_telemetry: ctx.get(TelemetryInitialization).isEnabled ? 'enabled' : 'disabled',
            public_code_suggestions: 'enabled',
          }),
        })
      ).json();
      return (signUpLimitedResult as any)?.subscribed || false;
    } catch (error) {
      authLogger.exception(ctx, error, 'signUpLimited failed');
      return false;
    }
  }

  async setAuthRecord(ctx: Context, authRecord: AuthRecord) {
    await this.authPersistence.saveAuthRecord(authRecord);
    this._copilotTokenManager.resetToken();
  }

  setTransientAuthRecord(ctx: Context, authRecord?: AuthRecord | null, resetToken = true): void {
    this._transientAuthRecord = authRecord;
    if (resetToken) {
      this._copilotTokenManager.resetToken();
    }
  }

  async deleteAuthRecord(ctx: Context) {
    await this.authPersistence.deleteAuthRecord();
    this._copilotTokenManager.resetToken();
  }
}

export { AuthManager };
