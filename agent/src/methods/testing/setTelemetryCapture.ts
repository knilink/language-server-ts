import { Type, type Static } from '@sinclair/typebox';

import { Context } from '../../../../lib/src/context.ts';
import { setupTelemetryReporters } from '../../../../lib/src/telemetry/setupTelemetryReporters.ts';
import { TelemetryReporters } from '../../../../lib/src/telemetry.ts';
import { PromiseQueue } from '../../../../lib/src/util/promiseQueue.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { TelemetrySpy } from '../../../../lib/src/testing/telemetrySpy.ts';
import { TestPromiseQueue } from '../../../../lib/src/testing/telemetry.ts';

const Params = Type.Object({ telemetryCapture: Type.Boolean() });

async function handleTestingSetTelemetryCaptureChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  if (params.telemetryCapture) {
    await setupTelemetryReporters(ctx, 'agent', false);
    ctx.get(TelemetryReporters).setReporter(new TelemetrySpy());
    ctx.get(TelemetryReporters).setRestrictedReporter(new TelemetrySpy());
    ctx.forceSet(PromiseQueue, new TestPromiseQueue());
  } else {
    await setupTelemetryReporters(ctx, 'agent', true);
    ctx.forceSet(PromiseQueue, new PromiseQueue());
  }
  return ['OK', null];
}

const handleTestingSetTelemetryCapture = addMethodHandlerValidation(Params, handleTestingSetTelemetryCaptureChecked);

export { Params, handleTestingSetTelemetryCapture };
