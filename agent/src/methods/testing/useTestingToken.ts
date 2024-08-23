import { Type, type Static } from '@sinclair/typebox';

import { type CancellationToken } from '../../cancellation';
import { type AuthRecord } from '../../../../lib/src/auth/types';

import { Context } from '../../../../lib/src/context';
import { getTestingCopilotTokenManager } from '../../../../lib/src/testing/copilotToken';
import { AuthManager } from '../../../../lib/src/auth/manager';
import { CopilotTokenManager } from '../../../../lib/src/auth/copilotTokenManager';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({
  options: Type.Optional(Type.Object({})),
  githubAppId: Type.Optional(Type.String()),
});

async function handleTestingUseTestingTokenChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  const tokenManager = getTestingCopilotTokenManager();
  ctx.forceSet(AuthManager, new FakeAuthManager(tokenManager, params.githubAppId));
  ctx.forceSet(CopilotTokenManager, tokenManager);
  return ['OK', null];
}

class FakeAuthManager extends AuthManager {
  readonly user: string = 'user';
  constructor(
    tokenManager: CopilotTokenManager,
    readonly githubAppId?: string
  ) {
    // MARK EDITED
    super(undefined!, tokenManager);
  }

  getAuthRecord(): Promise<AuthRecord> {
    return Promise.resolve({ user: this.user, oauth_token: '', githubAppId: this.githubAppId });
  }
}

const handleTestingUseTestingToken = addMethodHandlerValidation(Params, handleTestingUseTestingTokenChecked);

export { FakeAuthManager, handleTestingUseTestingToken };
