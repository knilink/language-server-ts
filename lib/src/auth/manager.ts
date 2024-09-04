import { GitHubToken, AuthStatus, AuthRecord } from './types.ts';
import { getBuildType } from '../config.ts';

import { Context } from '../context.ts'; // replace with actual import path if exists
import { AuthPersistence } from './authPersistence.ts'; // replace with actual import path if exists
import { CopilotTokenManager } from './copilotTokenManager.ts'; // replace with actual import path if exists

class AuthManager {
  private _copilotTokenManager: CopilotTokenManager;
  private _pendingSignIn?: Promise<AuthStatus>;
  private _transientAuthRecord?:
    | AuthRecord
    // ../../../agent/src/service.ts
    | null;

  constructor(
    readonly authPersistence: AuthPersistence,
    copilotTokenManager: CopilotTokenManager
  ) {
    this._copilotTokenManager = copilotTokenManager;
  }

  getCopilotTokenManager(): CopilotTokenManager {
    return this._copilotTokenManager;
  }

  // ../../../agent/src/methods/signInConfirm.ts
  setPendingSignIn(promise: Promise<AuthStatus> | undefined): void {
    this._pendingSignIn = promise;
  }

  getPendingSignIn(): Promise<AuthStatus> | undefined {
    return this._pendingSignIn;
  }

  async checkAndUpdateStatus(
    ctx: Context,
    options?: { localChecksOnly?: boolean; forceRefresh?: boolean }
  ): Promise<AuthStatus> {
    let localChecksOnly = options?.localChecksOnly ?? false;
    let authRecord: AuthRecord | undefined;

    if (process.env.CODESPACES === 'true' && process.env.GITHUB_TOKEN) {
      authRecord = {
        user: process.env.GITHUB_USER || 'codespace-user',
        oauth_token: process.env.GITHUB_TOKEN,
      };
    }

    if (!authRecord) {
      authRecord = await this.getAuthRecord();
    }

    if (!authRecord) {
      this._copilotTokenManager.resetCopilotToken(ctx);
      return { status: 'NotSignedIn' };
    }

    if (localChecksOnly) {
      return { status: 'MaybeOK', user: authRecord.user };
    }

    if (options?.forceRefresh) {
      this._copilotTokenManager.resetCopilotToken(ctx);
    }

    const checkTokenResult = await this._copilotTokenManager.checkCopilotToken(ctx);

    //     return 'status' in checkTokenResult
    //       ? { status: 'OK', user: authRecord.user }
    //       : {
    //         status: checkTokenResult.reason === 'HTTP401' ? 'NotSignedIn' : checkTokenResult.reason,
    //         user: authRecord.user,
    //       };
    if ('status' in checkTokenResult) {
      return { status: 'OK', user: authRecord.user };
    }

    if (checkTokenResult.reason === 'HTTP401') {
      return { status: 'NotSignedIn', user: authRecord.user };
    }
    return { status: 'Other', user: authRecord.user, reason: checkTokenResult.reason };
  }

  async getAuthRecord(): Promise<AuthRecord | undefined> {
    // skip when set as null at ../../../agent/src/service.ts
    if (this._transientAuthRecord === null) return;
    // getPersistedAuthRecord when _transientAuthRecord is undefined
    return this._transientAuthRecord ?? this.getPersistedAuthRecord();
  }

  async getPersistedAuthRecord(): Promise<AuthRecord> {
    return await this.authPersistence.getAuthRecord();
  }

  async getGitHubToken(ctx: Context): Promise<GitHubToken | undefined> {
    if (process.env.CODESPACES === 'true' && process.env.GITHUB_TOKEN) {
      return { token: process.env.GITHUB_TOKEN };
    }

    const authRecord = await this.getAuthRecord();
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

  async setAuthRecord(ctx: Context, authRecord: AuthRecord) {
    await this.authPersistence.saveAuthRecord(authRecord);
    this._copilotTokenManager.resetCopilotToken(ctx);
  }

  async setTransientAuthRecord(ctx: Context, authRecord?: AuthRecord | null): Promise<void> {
    this._transientAuthRecord = authRecord;
    this._copilotTokenManager.resetCopilotToken(ctx);
  }

  async deleteAuthRecord(ctx: Context) {
    await this.authPersistence.deleteAuthRecord();
    this._copilotTokenManager.resetCopilotToken(ctx);
  }
}

export { AuthManager };
