import type { Context } from '../../../lib/src/context.ts';
import type { Disposable } from 'vscode-languageserver/node.js';
import type { GitHubToken, TokenEnvelope } from '../../../lib/src/auth/types.ts';

import { ProtocolRequestType } from '../../../node_modules/vscode-languageserver/lib/node/main.js';
import { CopilotCapabilitiesProvider } from '../editorFeatures/capabilities.ts';
import { Service } from '../service.ts';
import {
  CopilotTokenManager,
  CopilotTokenManagerFromAuthManager,
  TokenResultError,
} from '../../../lib/src/auth/copilotTokenManager.ts';
import { emitCopilotToken } from '../../../lib/src/auth/copilotTokenNotifier.ts';
import { CopilotToken } from '../../../lib/src/auth/copilotToken.ts';
import { CopilotAuthError } from '../../../lib/src/auth/error.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { Logger } from '../../../lib/src/logger.ts';
import { NetworkConfiguration } from '../../../lib/src/networkConfiguration.ts';

const logger = new Logger('copilotTokenManager');

class AgentClientCopilotTokenManager extends CopilotTokenManagerFromAuthManager {
  static RequestType = new ProtocolRequestType<
    { force: boolean },
    {
      envelope: TokenEnvelope;
      accessToken: string;
      handle: string;
      githubAppId: string;
      tokenEndpoint: string;
    },
    unknown,
    unknown,
    unknown
  >('copilot/token');

  copilotToken?: Promise<CopilotToken>;
  didChangeToken?: Disposable;

  async fetchCopilotTokenEnvelope(): Promise<TokenEnvelope> {
    let connection = this.ctx.get(Service).connection;
    try {
      this.didChangeToken ??= connection.onNotification('copilot/didChangeToken', () => {
        this.resetToken();
      });
      const response = await connection.sendRequest(AgentClientCopilotTokenManager.RequestType, { force: false });
      if (!response?.envelope) {
        logger.debug(this.ctx, 'Envelope missing from copilot/token response');
        throw new TokenResultError({ reason: 'NotSignedIn', message: 'Editor did not return a token' });
      }
      const { accessToken, handle, githubAppId, envelope, tokenEndpoint } = response;
      logger.debug(this.ctx, 'Retrieved envelope from copilot/token');
      let copilotToken = new CopilotToken(envelope);
      if (copilotToken.isExpired()) {
        throw new CopilotAuthError('Expired token in copilot/token response');
      }
      if (handle && accessToken) {
        this.ctx
          .get(AuthManager)
          .setTransientAuthRecord(this.ctx, { user: handle, oauth_token: accessToken, githubAppId }, false);
      } else if (!(await this.getGitHubSession())) {
        throw new TokenResultError({ reason: 'NotSignedIn' });
      }

      if (tokenEndpoint !== undefined) {
        this.ctx.get(NetworkConfiguration).updateBaseUrlFromTokenEndpoint(this.ctx, tokenEndpoint);
      }

      emitCopilotToken(this.ctx, copilotToken);
      return envelope;
    } catch (e) {
      throw e instanceof Error ? new CopilotAuthError(e.message, e) : e;
    }
  }
}

class AgentCopilotTokenManager extends CopilotTokenManager {
  readonly client: AgentClientCopilotTokenManager;

  constructor(
    readonly ctx: Context,
    readonly fallback = new CopilotTokenManagerFromAuthManager(ctx)
  ) {
    super();
    this.client = new AgentClientCopilotTokenManager(ctx);
  }

  canGetToken(): boolean {
    return this.ctx.get(CopilotCapabilitiesProvider).getCapabilities().token ?? false;
  }

  getDelegate(): CopilotTokenManager {
    return this.canGetToken() ? this.client : this.fallback;
  }

  resetToken(httpError?: number): void {
    this.getDelegate().resetToken(httpError);
  }

  async getToken(): Promise<CopilotToken> {
    return await this.getDelegate().getToken();
  }

  async getGitHubSession(): Promise<GitHubToken | undefined> {
    return await this.fallback.getGitHubSession();
  }
}

export { AgentCopilotTokenManager };
