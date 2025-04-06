import type { Static } from '@sinclair/typebox';
import type { Context } from '../../../../lib/src/context.ts';

import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { CopilotTokenManager } from '../../../../lib/src/auth/copilotTokenManager.ts';
import { AuthManager } from '../../../../lib/src/auth/manager.ts';
import { StatusReporter } from '../../../../lib/src/progress.ts';
import { AlwaysAuthManager } from '../../../../lib/src/testing/auth.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({ options: Type.Optional(Type.Object({})) });

async function handleTestingAlwaysAuthChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.forceSet(AuthManager, new AlwaysAuthManager());
  ctx.get(CopilotTokenManager).resetToken();
  ctx.get(StatusReporter).forceNormal();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return ['OK', null];
}

export const handleTestingAlwaysAuth = addMethodHandlerValidation(Params, handleTestingAlwaysAuthChecked);
