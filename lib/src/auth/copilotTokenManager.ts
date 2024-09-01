import { GitHubToken } from "./types.ts";
import { CopilotAuthStatus } from "./types.ts";
import { EventEmitter } from 'events';

import { Context } from "../context.ts";
import { telemetry } from "../telemetry.ts";
import { CopilotAuthError } from "./error.ts";
import { AuthManager } from "./manager.ts";
import { CopilotToken, authFromGitHubToken, authLogger, refreshToken } from "./copilotToken.ts";

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

abstract class CopilotTokenManagerFromGitHubTokenBase extends CopilotTokenManager {
  private copilotToken?: CopilotToken;

  async getCopilotToken(ctx: Context, force: boolean): Promise<CopilotToken> {
    if (!this.copilotToken || this.copilotToken.isExpired() || force) {
      const gitHubToken = await this.getGitHubSession(ctx);
      if (!gitHubToken) throw new CopilotAuthError('Not signed in');

      const tokenResult = await authFromGitHubToken(ctx, gitHubToken);
      if (tokenResult.kind === 'failure') {
        if (tokenResult.message) throw new CopilotAuthError(tokenResult.message);
        const error = new Error(`Unexpected error getting Copilot token: ${tokenResult.reason}`);
        (error as any).code = `CopilotToken.${tokenResult.reason}`;
        throw error;
      }

      this.copilotToken = new CopilotToken(tokenResult.envelope);
      refreshToken(ctx, this, this.copilotToken.refreshIn);
    }

    return this.copilotToken;
  }

  async checkCopilotToken(ctx: Context): Promise<Extract<CopilotAuthStatus, { kind: 'failure' }> | { status: 'OK' }> {
    if (!this.copilotToken || this.copilotToken.isExpired()) {
      const gitHubToken = await this.getGitHubSession(ctx);
      if (!gitHubToken) throw new CopilotAuthError('Not signed in');

      const tokenResult = await authFromGitHubToken(ctx, gitHubToken);
      if (tokenResult.kind === 'failure') return tokenResult;

      this.copilotToken = new CopilotToken(tokenResult.envelope);
      refreshToken(ctx, this, this.copilotToken.refreshIn);
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
