import { DidChangeAuthNotification, DidChangeAuthParams, DidChangeAuthParamsType } from '../../../types/src/index.ts';

import { AbstractNotification } from './abstract.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';

export class DidChangeAuthNotificationHandler extends AbstractNotification {
  readonly name = DidChangeAuthNotification.method;
  readonly params = DidChangeAuthParams;

  async handle(params?: DidChangeAuthParamsType): Promise<void> {
    const authManager = this.ctx.get(AuthManager);

    if (params && params.handle && params.accessToken) {
      authManager.setTransientAuthRecord(this.ctx, {
        oauth_token: params.accessToken,
        user: params.handle,
        githubAppId: params.githubAppId,
      });
    } else {
      authManager.setTransientAuthRecord(this.ctx, null);
    }
  }
}

export const githubNotifications: AbstractNotification.Ctor[] = [DidChangeAuthNotificationHandler];
