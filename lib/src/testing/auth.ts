import { type Context } from '../context.ts';

import { type AuthStatus } from '../auth/types.ts';

import { AuthManager } from '../auth/manager.ts';
import { FixedCopilotTokenManager } from './tokenManager.ts';

class NotAuthManager extends AuthManager {
  constructor() {
    super(
      // MAKR IDK
      null!,
      // MAKR IDK
      null!
    );
  }

  async checkAndUpdateStatus(
    _ctx: Context,
    options: { localChecksOnly?: boolean; forceRefresh?: boolean }
  ): Promise<AuthStatus> {
    return { status: 'NotSignedIn' };
  }
}

class AlwaysAuthManager extends AuthManager {
  constructor() {
    super(
      // MAKR IDK
      null!,
      new FixedCopilotTokenManager('tid=valid-copilot-token')
    );
  }

  getAuthRecord(): Promise<{ user: string; oauth_token: string; githubAppId: string }> {
    return Promise.resolve({ user: 'user', oauth_token: '', githubAppId: '' });
  }
}

export { NotAuthManager, AlwaysAuthManager };
