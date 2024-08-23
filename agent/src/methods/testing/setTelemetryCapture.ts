import { Type, type Static } from '@sinclair/typebox';
import { CancellationToken } from '../../cancellation';

import { Context } from '../../../../lib/src/context';
import { setupTelemetryReporters } from '../../../../lib/src/telemetry/setupTelemetryReporters';
import { TelemetryReporters } from '../../../../lib/src/telemetry';
import { PromiseQueue } from '../../../../lib/src/util/promiseQueue';
import { addMethodHandlerValidation } from '../../schemaValidation';
import { TelemetrySpy } from '../../../../lib/src/testing/telemetrySpy';
import { TestPromiseQueue } from '../../../../lib/src/testing/telemetry';

const Params = Type.Object({ telemetryCapture: Type.Boolean() });

async function handleTestingSetTelemetryCaptureChecked(
  ctx: Context,
  token: CancellationToken,
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
