import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';

import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { Fetcher } from '../../../../lib/src/networking.ts';
import { ExpConfigFetcherWithDelegate } from '../../../../lib/src/testing/expServerFake.ts';
import { Type } from '@sinclair/typebox';

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
