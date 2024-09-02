import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';

import { Context } from '../../../../lib/src/context.ts';
import { AuthManager } from '../../../../lib/src/auth/manager.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { NotAuthManager } from '../../../../lib/src/testing/auth.ts';

const Params = Type.Object({ options: Type.Optional(Type.Object({})) });

async function handleTestingNeverAuthChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.forceSet(AuthManager, new NotAuthManager());
  return ['OK', null];
}

const handleTestingNeverAuth = addMethodHandlerValidation(Params, handleTestingNeverAuthChecked);

export { handleTestingNeverAuth };
