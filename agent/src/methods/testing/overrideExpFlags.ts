import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';

import { Context } from '../../../../lib/src/context';
import { Fetcher } from '../../../../lib/src/networking';
import { ExpConfigMaker, ExpConfigFromTAS } from '../../../../lib/src/experiments/fetchExperiments';
import { addMethodHandlerValidation } from '../../schemaValidation';
import { ExpConfigFetcherWithDelegate } from '../../../../lib/src/testing/expServerFake';

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
    ctx.forceSet(ExpConfigMaker, new ExpConfigFromTAS());
  }
  return ['OK', null];
}

const handleTestingOverrideExpFlags = addMethodHandlerValidation(Params, handleTestingOverrideExpFlagsChecked);

export { handleTestingOverrideExpFlags };
