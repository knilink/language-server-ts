import { Type, type Static } from '@sinclair/typebox';

import { Context } from '../../../lib/src/context.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { telemetryShown } from '../../../lib/src/ghostText/telemetry.ts';
import { TestingOptions } from './testingOptions.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';

const Params = Type.Object({
  uuid: Type.String({ minLength: 1 }),
  options: Type.Optional(TestingOptions),
});

async function notifyShownChecked(ctx: Context, token: unknown, params: Static<typeof Params>): Promise<['OK', null]> {
  const completion = ctx.get(CopilotCompletionCache).get(params.uuid);
  if (completion) {
    telemetryShown(ctx, completion.triggerCategory, completion);
  }
  return ['OK', null];
}

const notifyShown = addMethodHandlerValidation(Params, notifyShownChecked);

export { notifyShown };
