import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';

import { Context } from '../../../../lib/src/context';
import { TelemetryReporters } from '../../../../lib/src/telemetry';
import { PromiseQueue } from '../../../../lib/src/util/promiseQueue';
import { TestPromiseQueue } from '../../../../lib/src/testing/telemetry';
import { addMethodHandlerValidation, type ValidationError } from '../../schemaValidation';
import { TelemetrySpy, Event, ErrorEvent } from '../../../../lib/src/testing/telemetrySpy';
// import { } from '../../rpc';

const Params = Type.Object({});

async function handleTestingGetTelemetryChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<
  | [
    {
      standard: { events: Event[]; errors: ErrorEvent[] };
      restricted: { events: Event[]; errors: ErrorEvent[] };
    },
    null,
  ]
  | [null, ValidationError]
> {
  let reporters = ctx.get(TelemetryReporters);
  const standardReporter = reporters.getReporter(ctx);
  const restrictedReporter = reporters.getRestrictedReporter(ctx);

  if (
    !(standardReporter instanceof TelemetrySpy) ||
    !(restrictedReporter instanceof TelemetrySpy || restrictedReporter === undefined)
  ) {
    return [
      null,
      { code: -32603, message: 'Telemetry is not being captured. You must first call testing/setTelemetryCapture.' },
    ];
  }

  let queue = ctx.get(PromiseQueue);
  if (queue instanceof TestPromiseQueue) {
    await queue.awaitPromises();
  }

  return [
    {
      standard: { events: standardReporter.events, errors: standardReporter.errors },
      restricted: {
        events: restrictedReporter?.events || [],
        errors: restrictedReporter?.errors || [],
      },
    },
    null,
  ];
}

const handleTestingGetTelemetry = addMethodHandlerValidation(Params, handleTestingGetTelemetryChecked);

export { Params, handleTestingGetTelemetry };
