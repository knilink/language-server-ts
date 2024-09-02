import { Type, type Static } from '@sinclair/typebox';

import { AbstractNotification } from './abstract.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';

export class DidChangeAuthNotification extends AbstractNotification {
  readonly name = 'github/didChangeAuth';
  readonly params = Type.Object({
    accessToken: Type.Optional(Type.String({ minLength: 1 })),
    handle: Type.Optional(Type.String({ minLength: 1 })),
    githubAppId: Type.Optional(Type.String({ minLength: 1 })),
  });

  async handle(params?: Static<typeof this.params>): Promise<void> {
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

export const githubNotifications = [DidChangeAuthNotification];
