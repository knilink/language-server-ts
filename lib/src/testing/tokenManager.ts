import { createTestCopilotToken } from './copilotToken.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import type {} from '../auth/copilotTokenNotifier.ts';
import type {} from '../auth/error.ts';

class FixedCopilotTokenManager extends CopilotTokenManager {
  wasReset = false;

  constructor(readonly token: string) {
    super();
  }
  async getGitHubSession() {
    return Promise.resolve({ token: 'token' });
  }
  async getToken() {
    return createTestCopilotToken({ token: this.token });
  }
  resetToken() {
    this.wasReset = true;
  }
  async checkCopilotToken() {
    return { status: 'OK' };
  }
}

export { FixedCopilotTokenManager };
