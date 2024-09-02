import { Context } from '../context.ts';
import { TelemetryWithExp } from '../telemetry.ts';

import { Features } from '../experiments/features.ts';

async function getDebounceLimit(ctx: Context, telemetryData: TelemetryWithExp): Promise<number> {
  let expDebounce: number;
  if (ctx.get(Features).debouncePredict(telemetryData) && telemetryData.measurements.contextualFilterScore) {
    const acceptProbability = telemetryData.measurements.contextualFilterScore;
    expDebounce = 25 + 250 / (1 + Math.pow(acceptProbability / 0.3475, 7));
  } else {
    expDebounce = ctx.get(Features).debounceMs(telemetryData);
  }
  return expDebounce > 0 ? expDebounce : 75;
}

export { getDebounceLimit };
