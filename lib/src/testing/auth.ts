import { type Context } from '../context';

import { type AuthStatus } from '../auth/types';

import { AuthManager } from '../auth/manager';
import { FixedCopilotTokenManager } from './tokenManager';

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
