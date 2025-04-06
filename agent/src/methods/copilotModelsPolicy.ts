import type { Context } from '../../../lib/src/context.ts';

import { ensureAuthenticated } from '../auth/authDecorator.ts';
import { ErrorCode } from '../rpc.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { ModelMetadataProvider } from '../../../lib/src/conversation/modelMetadata.ts';
import { Type, type Static } from '@sinclair/typebox';

async function handleCopilotModelsPolicyChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<['OK', null] | [null, { code: number; message: string }]> {
  if (!params.model || params.status !== 'enabled')
    return [null, { code: ErrorCode.InvalidRequest, message: 'Invalid model or status' }];

  if (!(await ctx.get(ModelMetadataProvider).acceptModelPolicy(params.model)))
    return [null, { code: ErrorCode.InternalError, message: 'Failed to accept model policy' }];

  return ['OK', null];
}

const Params = Type.Object({ model: Type.Optional(Type.String()), status: Type.Optional(Type.String()) });

const handleCopilotModelsPolicy = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleCopilotModelsPolicyChecked)
);

export { handleCopilotModelsPolicy };
