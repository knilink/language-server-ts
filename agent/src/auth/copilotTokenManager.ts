import { ProtocolRequestType, Disposable } from "vscode-languageserver/node.js";
import type { GitHubToken, TokenEnvelope, AuthRecord } from '../../../lib/src/auth/types.ts';

import { Context } from '../../../lib/src/context.ts';
import { CopilotTokenNotifier } from '../../../lib/src/auth/copilotTokenNotifier.ts';
import { Service } from '../service.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { CopilotCapabilitiesProvider } from '../editorFeatures/capabilities.ts';
import { Logger, LogLevel } from '../../../lib/src/logger.ts';
import { CopilotToken } from '../../../lib/src/auth/copilotToken.ts';
import { CopilotAuthError } from '../../../lib/src/auth/error.ts';
import { CopilotTokenManagerFromAuthManager } from '../../../lib/src/auth/copilotTokenManager.ts';

import { CopilotTokenManager } from '../../../lib/src/auth/copilotTokenManager.ts';

const logger = new Logger(LogLevel.DEBUG, 'copilotTokenManager');

class AgentClientCopilotTokenManager extends CopilotTokenManager {
  static RequestType = new ProtocolRequestType<
    { force: boolean },
    { envelope: TokenEnvelope; accessToken: string; handle: string; githubAppId: string },
    unknown,
    unknown,
    unknown
  >('copilot/token');

  private copilotToken?: CopilotToken;
  private didChangeToken?: Disposable;

  createCopilotEnvelope(ctx: Context, envelope: TokenEnvelope): CopilotToken {
    const copilotToken = new CopilotToken(envelope);
    ctx.get(CopilotTokenNotifier).emit('onCopilotToken', copilotToken);
    return copilotToken;
  }

  setCopilotEnvelope(ctx: Context, envelope: TokenEnvelope): void {
    this.copilotToken = this.createCopilotEnvelope(ctx, envelope);
  }

  async getCopilotToken(ctx: Context, force: boolean = false): Promise<CopilotToken> {
    let connection = ctx.get(Service).connection;
    if (!this.copilotToken || this.copilotToken.isExpired() || force) {
      try {
        this.didChangeToken ??= connection.onNotification('copilot/didChangeToken', () => {
          this.copilotToken = undefined;
        });

        const response = await connection.sendRequest(AgentClientCopilotTokenManager.RequestType, { force });

        if (!response?.envelope) {
          logger.debug(ctx, 'Envelope missing from copilot/token response');
          throw new CopilotAuthError('Editor did not return a token');
        }
        logger.debug(ctx, 'Retrieved envelope from copilot/token');
        const { accessToken, handle, githubAppId, envelope } = response;
        if (handle && accessToken) {
          ctx.get(AuthManager).setTransientAuthRecord(ctx, {
            user: handle,
            oauth_token: accessToken,
            githubAppId: githubAppId,
          });
        } else if (!(await this.getGitHubSession(ctx))) {
          throw new CopilotAuthError('Not signed in');
        }

        this.copilotToken = this.createCopilotEnvelope(ctx, envelope);
      } catch (e) {
        throw e instanceof Error ? new CopilotAuthError(e.message, e) : e;
      }
    }

    return this.copilotToken;
  }

  async checkCopilotToken(ctx: Context): Promise<{ status: 'OK' }> {
    await this.getCopilotToken(ctx);
    return { status: 'OK' };
  }

  resetCopilotToken(ctx: Context, httpError?: number): void {
    this.copilotToken = undefined;
  }

  async getGitHubSession(ctx: Context): Promise<GitHubToken | undefined> {
    return await ctx.get(AuthManager).getGitHubToken(ctx);
  }
}

class AgentCopilotTokenManager extends CopilotTokenManager {
  readonly client = new AgentClientCopilotTokenManager();

  constructor(readonly fallback = new CopilotTokenManagerFromAuthManager()) {
    super();
  }

  canGetToken(ctx: Context): boolean {
    const capabilities = ctx.get(CopilotCapabilitiesProvider).getCapabilities();
    return !!capabilities.token;
  }

  getDelegate(ctx: Context): CopilotTokenManager {
    return this.canGetToken(ctx) ? this.client : this.fallback;
  }

  resetCopilotToken(ctx: Context, httpError?: number): void {
    this.getDelegate(ctx).resetCopilotToken(ctx, httpError);
  }

  async getCopilotToken(ctx: Context, force: boolean = false): Promise<CopilotToken> {
    return await this.getDelegate(ctx).getCopilotToken(ctx, force);
  }

  async checkCopilotToken(ctx: Context) {
    return await this.getDelegate(ctx).checkCopilotToken(ctx);
  }

  async getGitHubSession(ctx: Context): Promise<GitHubToken | undefined> {
    return await this.fallback.getGitHubSession(ctx);
  }

  setCopilotEnvelope(ctx: Context, envelope: TokenEnvelope): void {
    if (!this.canGetToken(ctx)) throw new Error('Tried to set token with no token copilotCapability');
    this.client.setCopilotEnvelope(ctx, envelope);
  }
}

export { AgentClientCopilotTokenManager, AgentCopilotTokenManager };
