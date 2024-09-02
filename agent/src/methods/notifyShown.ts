import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../cancellation.ts';

import { Context } from '../../../lib/src/context.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { telemetryShown } from '../../../lib/src/ghostText/telemetry.ts';
import { TestingOptions } from './testingOptions.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';

const Params = Type.Object({
  uuid: Type.String({ minLength: 1 }),
  options: Type.Optional(TestingOptions),
});

async function notifyShownChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  const completion = ctx.get<CopilotCompletionCache>(CopilotCompletionCache).get(params.uuid);
  if (completion) {
    const fromCache = completion.resultType !== 0;
    telemetryShown(ctx, completion.triggerCategory, completion.telemetry, fromCache);
  }
  return ['OK', null];
}

const notifyShown = addMethodHandlerValidation(Params, notifyShownChecked);

export { notifyShown };
