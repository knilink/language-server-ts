import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';

import { Context } from '../../../../lib/src/context';
import { AuthManager } from '../../../../lib/src/auth/manager';
import { addMethodHandlerValidation } from '../../schemaValidation';
import { NotAuthManager } from '../../../../lib/src/testing/auth';

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
