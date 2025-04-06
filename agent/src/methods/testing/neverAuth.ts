import { Type, type Static } from '@sinclair/typebox';

import { Context } from '../../../../lib/src/context.ts';
import { AuthManager } from '../../../../lib/src/auth/manager.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { CopilotTokenManager } from '../../../../lib/src/auth/copilotTokenManager.ts';
import { NotAuthManager } from '../../../../lib/src/testing/auth.ts';

const Params = Type.Object({ options: Type.Optional(Type.Object({})) });

async function handleTestingNeverAuthChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.forceSet(AuthManager, new NotAuthManager());
  ctx.get(CopilotTokenManager).resetToken();
  try {
    await ctx.get(CopilotTokenManager).getToken();
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 0));
  return ['OK', null];
}

const handleTestingNeverAuth = addMethodHandlerValidation(Params, handleTestingNeverAuthChecked);

export { handleTestingNeverAuth };
