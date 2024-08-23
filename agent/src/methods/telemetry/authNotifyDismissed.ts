import { Type, type Static } from '@sinclair/typebox';

import { type CancellationToken } from '../../cancellation';
import { type Context } from '../../../../lib/src/context';

import { telemetryAuthNotifyDismissed } from '../../../../lib/src/telemetry/auth';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({});

async function handleTelemetryAuthNotifyDismissedChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  await telemetryAuthNotifyDismissed(ctx);
  return ['OK', null];
}

const handleTelemetryAuthNotifyDismissed = addMethodHandlerValidation(
  Params,
  handleTelemetryAuthNotifyDismissedChecked
);

export { handleTelemetryAuthNotifyDismissed };
