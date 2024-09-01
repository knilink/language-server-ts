import { Context } from "../context.ts";
import { GitHubToken } from "../auth/types.ts";
import { CopilotToken, CopilotTokenManagerFromGitHubTokenBase } from "../auth/copilotToken.ts";
import { CopilotTokenManager } from "../auth/copilotTokenManager.ts";

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
