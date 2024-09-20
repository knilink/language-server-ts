import { GitHubToken } from './types.ts';
import { CopilotAuthStatus } from './types.ts';
import { EventEmitter } from 'node:events';

import { Context } from '../context.ts';
import { telemetry } from '../telemetry.ts';
import { CopilotAuthError } from './error.ts';
import { AuthManager } from './manager.ts';
import { CopilotToken, authFromGitHubToken, authLogger, refreshToken } from './copilotToken.ts';

abstract class CopilotTokenManager {
  readonly tokenRefreshEventEmitter: EventEmitter = new EventEmitter();

  async getGitHubToken(ctx: Context): Promise<string | undefined> {
    const session = await this.getGitHubSession(ctx);
    return session ? session.token : undefined;
  }

  abstract getGitHubSession(ctx: Context): Promise<GitHubToken | undefined>;
  abstract getCopilotToken(ctx: Context, force?: boolean): Promise<CopilotToken>;
  // ../openai/fetch.ts httpError: number
  abstract resetCopilotToken(ctx: Context, httpError?: number): void;
  abstract checkCopilotToken(ctx: Context): Promise<Extract<CopilotAuthStatus, { kind: 'failure' }> | { status: 'OK' }>;
}

class TokenResultError extends CopilotAuthError {
  constructor(readonly result: Extract<CopilotAuthStatus, { kind: 'failure' }>) {
    super(result.message ?? '');
  }
}

abstract class CopilotTokenManagerFromGitHubTokenBase extends CopilotTokenManager {
  copilotToken?: Promise<CopilotToken>;

  async getCopilotToken(ctx: Context, force?: boolean): Promise<CopilotToken> {
    if (this.copilotToken && !force) {
      const token = await this.copilotToken;
      if (!token.isExpired()) return token;
    }

    this.copilotToken = (async () => {
      const gitHubToken = await this.getGitHubSession(ctx);
      if (!gitHubToken) throw new CopilotAuthError('Not signed in');
      const tokenResult = await authFromGitHubToken(ctx, gitHubToken);
      if (tokenResult.kind === 'failure') {
        if (tokenResult.message) throw new TokenResultError(tokenResult);
        const error: any = new Error(`Unexpected error getting Copilot token: ${tokenResult.reason}`);
        error.code = `CopilotToken.${tokenResult.reason}`;
        throw error;
      }
      const copilotToken = new CopilotToken(tokenResult.envelope);
      refreshToken(ctx, this, copilotToken.refreshIn);
      return copilotToken;
    })();

    this.copilotToken.catch(() => {
      this.copilotToken = undefined;
    });
    return this.copilotToken;
  }

  async checkCopilotToken(ctx: Context): Promise<Extract<CopilotAuthStatus, { kind: 'failure' }> | { status: 'OK' }> {
    try {
      await this.getCopilotToken(ctx);
    } catch (e) {
      if (e instanceof TokenResultError) return e.result;
      throw e;
    }
    return { status: 'OK' };
  }

  resetCopilotToken(ctx: Context, httpError?: number): void {
    if (httpError !== undefined) {
      telemetry(ctx, `auth.reset_token_${httpError}`);
      authLogger.debug(ctx, `Resetting copilot token on HTTP error ${httpError}`);
    } else {
      authLogger.debug(ctx, 'Resetting copilot token');
    }

    this.copilotToken = undefined;
  }
}

class CopilotTokenManagerFromAuthManager extends CopilotTokenManagerFromGitHubTokenBase {
  async getGitHubSession(ctx: Context) {
    return await ctx.get(AuthManager).getGitHubToken(ctx);
  }
}

export { CopilotTokenManagerFromGitHubTokenBase, CopilotTokenManager, CopilotTokenManagerFromAuthManager };
