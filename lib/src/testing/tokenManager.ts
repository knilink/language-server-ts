import { Context } from '../context';
import { GitHubToken } from '../auth/types';
import { CopilotToken, CopilotTokenManagerFromGitHubTokenBase } from '../auth/copilotToken';
import { CopilotTokenManager } from '../auth/copilotTokenManager';

class FakeCopilotTokenManagerFromGitHubToken extends CopilotTokenManagerFromGitHubTokenBase {
  constructor(readonly githubToken: GitHubToken) {
    super();
  }

  async getGitHubSession(ctx: Context): Promise<GitHubToken> {
    return this.githubToken;
  }
}

class FixedCopilotTokenManager extends CopilotTokenManager {
  wasReset = false;

  constructor(readonly token: string) {
    super();
  }

  async getGitHubSession(ctx: Context): Promise<{ token: string }> {
    return { token: 'token' };
  }

  async getCopilotToken(ctx: Context, force: boolean): Promise<CopilotToken> {
    return CopilotToken.testToken({ token: this.token });
  }

  resetCopilotToken(ctx: Context, httpError: unknown): void {
    this.wasReset = true;
  }

  async checkCopilotToken(ctx: Context): Promise<{ status: 'OK' }> {
    return { status: 'OK' };
  }
}

export { FakeCopilotTokenManagerFromGitHubToken, FixedCopilotTokenManager };
