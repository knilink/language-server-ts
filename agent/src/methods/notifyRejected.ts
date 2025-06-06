import type { Static } from '@sinclair/typebox';
import type { Context } from '../../../lib/src/context.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';

import { TestingOptions } from './testingOptions.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { LastGhostText } from '../../../lib/src/ghostText/last.ts';
import { postRejectionTasks } from '../../../lib/src/postInsertion.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({
  uuids: Type.Array(Type.String()),
  options: Type.Optional(TestingOptions),
});

async function notifyRejectedChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  const cache = ctx.get(CopilotCompletionCache);
  const completions = params.uuids.flatMap((uuid) => cache.get(uuid) ?? []);

  if (completions.length > 0) {
    const completion = completions[0];
    for (const uuid of params.uuids) {
      cache.delete(uuid);
    }
    const rejectionInput = completions.map((c) => ({
      completionText: c.displayText,
      completionTelemetryData: c.telemetry,
    }));
    postRejectionTasks(ctx, 'ghostText', completion.offset, completion.uri, rejectionInput);
    ctx.get(LastGhostText).resetState();
  }

  return ['OK', null];
}

const notifyRejected = addMethodHandlerValidation(Params, notifyRejectedChecked);

export { notifyRejected };
