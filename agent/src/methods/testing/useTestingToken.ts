import type { Context } from '../../../../lib/src/context.ts';
import { type Static } from '@sinclair/typebox';

import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { AuthRecord } from '../../../../lib/src/auth/types.ts';

import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { CopilotTokenManager } from '../../../../lib/src/auth/copilotTokenManager.ts';
import { AuthManager } from '../../../../lib/src/auth/manager.ts';
import { setTestingCopilotTokenManager } from '../../../../lib/src/testing/copilotToken.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({
  options: Type.Optional(Type.Object({})),
  githubAppId: Type.Optional(Type.String()),
});

async function handleTestingUseTestingTokenChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  await setTestingCopilotTokenManager(ctx);
  ctx.forceSet(AuthManager, new FakeAuthManager(ctx.get(CopilotTokenManager), params.githubAppId));
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
