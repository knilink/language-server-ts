import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';

import { Context } from '../../../../lib/src/context.ts';
import { Fetcher } from '../../../../lib/src/networking.ts';
import { ExpConfigMaker, ExpConfigFromTAS } from '../../../../lib/src/experiments/fetchExperiments.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { ExpConfigFetcherWithDelegate } from '../../../../lib/src/testing/expServerFake.ts';

const Params = Type.Object({
  expFlags: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
});

async function handleTestingOverrideExpFlagsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  if (params.expFlags) {
    const expConfig = { AssignmentContext: 'assignmentcontext', Parameters: { ...params.expFlags } };
    ctx.forceSet(Fetcher, new ExpConfigFetcherWithDelegate(expConfig, ctx.get(Fetcher)));
  }
  return ['OK', null];
}

const handleTestingOverrideExpFlags = addMethodHandlerValidation(Params, handleTestingOverrideExpFlagsChecked);

export { handleTestingOverrideExpFlags };
