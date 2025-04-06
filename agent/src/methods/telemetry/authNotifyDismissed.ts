import { Type, type Static } from '@sinclair/typebox';
import { type Context } from '../../../../lib/src/context.ts';

import { telemetryAuthNotifyDismissed } from '../../../../lib/src/telemetry/auth.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';

const Params = Type.Object({});

async function handleTelemetryAuthNotifyDismissedChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  telemetryAuthNotifyDismissed(ctx);
  return ['OK', null];
}

const handleTelemetryAuthNotifyDismissed = addMethodHandlerValidation(
  Params,
  handleTelemetryAuthNotifyDismissedChecked
);

export { handleTelemetryAuthNotifyDismissed };
