import { Type, type Static } from '@sinclair/typebox';
import { type Context } from '../../../../lib/src/context.ts';

import { AuthManager } from '../../../../lib/src/auth/manager.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { AlwaysAuthManager } from '../../../../lib/src/testing/auth.ts';
import { CancellationToken } from 'vscode-languageserver';

const Params = Type.Object({ options: Type.Optional(Type.Object({})) });

async function handleTestingAlwaysAuthChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.forceSet(AuthManager, new AlwaysAuthManager());
  return ['OK', null];
}

export const handleTestingAlwaysAuth = addMethodHandlerValidation(Params, handleTestingAlwaysAuthChecked);
