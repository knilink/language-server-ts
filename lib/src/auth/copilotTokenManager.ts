import { GitHubToken, TokenEnvelope } from './types.ts';
import { CopilotAuthStatus } from './types.ts';

import type { Context } from '../context.ts';

import { CopilotToken, authFromGitHubToken, authLogger } from './copilotToken.ts';
import { CopilotAuthError } from './error.ts';
import { AuthManager } from './manager.ts';
import { StatusReporter } from '../progress.ts';
import { telemetry } from '../telemetry.ts';

abstract class CopilotTokenManager {
  async getGitHubToken(): Promise<string | undefined> {
    const token = await this.getGitHubSession();
    return token?.token;
  }

  abstract getGitHubSession(): Promise<GitHubToken | undefined>;
  abstract getToken(force?: boolean): Promise<CopilotToken>;
  // ../openai/fetch.ts httpError: number
  abstract resetToken(httpError?: number): void;
}

class TokenResultError extends CopilotAuthError {
  constructor(readonly result: { reason: string; message?: string; envelope?: any }) {
    super(result.message ?? '');
  }
}

abstract class CopilotTokenManagerFromGitHubTokenBase extends CopilotTokenManager {
  token?: CopilotToken;
  tokenPromise?: Promise<CopilotToken>;

  constructor(readonly ctx: Context) {
    super();
  }

  async fetchCopilotTokenEnvelope(): Promise<TokenEnvelope> {
    let gitHubToken = await this.getGitHubSession();
    if (!gitHubToken) {
      throw new TokenResultError({ reason: 'NotSignedIn' });
    }
    if (!gitHubToken?.token) {
      throw new TokenResultError({ reason: 'HTTP401' });
    }
    let tokenResult = await authFromGitHubToken(this.ctx, gitHubToken);
    if (tokenResult.kind === 'failure') {
      if (tokenResult.message) {
        throw new TokenResultError(tokenResult);
      }
      let error = new Error(`Unexpected error getting Copilot token: ${tokenResult.reason}`);
      (error as any).code = `CopilotToken.${tokenResult.reason}`;
      throw error;
    }
    return tokenResult.envelope;
  }

  // async getToken(): Promise<CopilotToken> {
  //   if (!this.tokenPromise && (!this.token || this.token?.needsRefresh())) {
  //     const tokenPromise = this.fetchCopilotTokenEnvelope().then(
  //       (env) => {
  //         const token = new CopilotToken(env);
  //         if (this.tokenPromise !== tokenPromise) {
  //           return token;
  //         }
  //         this.token = token;
  //         this.tokenPromise = undefined;
  //         this.ctx.get(StatusReporter).forceNormal();
  //         return this.token;
  //       },
  //       (e) => {
  //         if (this.tokenPromise !== tokenPromise) {
  //           throw e;
  //         }
  //         this.tokenPromise = undefined;
  //         const reporter = this.ctx.get(StatusReporter);
  //         if (e instanceof TokenResultError) {
  //           switch (e.result.reason) {
  //             case 'NotSignedIn':
  //               reporter.setError('You are not signed into GitHub.', {
  //                 command: 'github.copilot.signIn',
  //                 title: 'Sign In',
  //               });
  //               break;
  //             case 'HTTP401':
  //               reporter.setError('Your GitHub token is invalid. Try signing in again.');
  //               break;
  //             case 'NotAuthorized':
  //               reporter.setError(e.message || 'No access to Copilot found.');
  //               break;
  //           }
  //         } else {
  //           reporter.setWarning(String(e));
  //         }
  //         throw e;
  //       }
  //     );
  //     this.tokenPromise = tokenPromise;
  //   }
  //   return this.token && !this.token.isExpired() ? this.token : await this.tokenPromise;
  // }

  async getToken(): Promise<CopilotToken> {
    // EDITED
    if (this.token && !this.token.needsRefresh()) return this.token;
    if (!this.tokenPromise) {
      const tokenPromise = this.fetchCopilotTokenEnvelope().then(
        (env) => {
          const token = new CopilotToken(env);
          if (this.tokenPromise !== tokenPromise) {
            return token;
          }
          this.token = token;
          this.tokenPromise = undefined;
          this.ctx.get(StatusReporter).forceNormal();
          return this.token;
        },
        (e) => {
          if (this.tokenPromise !== tokenPromise) {
            throw e;
          }
          this.tokenPromise = undefined;
          const reporter = this.ctx.get(StatusReporter);
          if (e instanceof TokenResultError) {
            switch (e.result.reason) {
              case 'NotSignedIn':
                reporter.setError('You are not signed into GitHub.', {
                  command: 'github.copilot.signIn',
                  title: 'Sign In',
                });
                break;
              case 'HTTP401':
                reporter.setError('Your GitHub token is invalid. Try signing in again.');
                break;
              case 'NotAuthorized':
                reporter.setError(e.message || 'No access to Copilot found.');
                break;
            }
          } else {
            reporter.setWarning(String(e));
          }
          throw e;
        }
      );
      this.tokenPromise = tokenPromise;
    }
    return await this.tokenPromise;
  }

  resetToken(httpError?: number) {
    if (httpError !== undefined) {
      telemetry(this.ctx, 'auth.reset_token_' + httpError);
      authLogger.debug(this.ctx, `Resetting copilot token on HTTP error ${httpError}`);
    } else {
      authLogger.debug(this.ctx, 'Resetting copilot token');
    }

    this.token = undefined;
    this.tokenPromise = undefined;
  }
}

class CopilotTokenManagerFromAuthManager extends CopilotTokenManagerFromGitHubTokenBase {
  async getGitHubSession(): Promise<GitHubToken | undefined> {
    return await this.ctx.get(AuthManager).getGitHubToken(this.ctx);
  }
}

export { CopilotTokenManager, CopilotTokenManagerFromAuthManager, TokenResultError };
