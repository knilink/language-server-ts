import { Type, type Static } from '@sinclair/typebox';
import { type Context } from '../../../lib/src/context';
import { type CancellationToken } from '../cancellation';
import { CopilotCompletionCache } from '../copilotCompletionCache';
import { postRejectionTasks } from '../../../lib/src/postInsertion';
import { LastGhostText } from '../../../lib/src/ghostText/last';
import { TestingOptions } from './testingOptions';
import { addMethodHandlerValidation } from '../schemaValidation';

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
    postRejectionTasks(ctx, 'ghostText', completion.offset, completion.file, rejectionInput);
    ctx.get(LastGhostText).resetState();
  }

  return ['OK', null];
}

const notifyRejected = addMethodHandlerValidation(Params, notifyRejectedChecked);

export { notifyRejected };
