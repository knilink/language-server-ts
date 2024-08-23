import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';
import { type Context } from '../../../../lib/src/context';

import { telemetryAuthNotifyShown } from '../../../../lib/src/telemetry/auth';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({
  authSource: Type.Union([Type.Literal('toast'), Type.Literal('goldbar'), Type.Literal('menu')]),
});

async function handleTelemetryAuthNotifyShownChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  await telemetryAuthNotifyShown(ctx, params.authSource);
  return ['OK', null];
}

const handleTelemetryAuthNotifyShown = addMethodHandlerValidation(Params, handleTelemetryAuthNotifyShownChecked);

export { handleTelemetryAuthNotifyShown };
