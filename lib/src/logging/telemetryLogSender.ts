import type { Context } from '../context.ts';

import { LogLevel, TelemetryLogSender } from '../logger.ts';
import { TelemetryData, telemetryError, telemetryException } from '../telemetry.ts';

function telemetryMessage(...extra: unknown[]) {
  return extra.length > 0 ? JSON.stringify(extra) : 'no msg';
}

class TelemetryLogSenderImpl extends TelemetryLogSender {
  sendError(ctx: Context, category: string, ...extra: unknown[]) {
    telemetryError(
      ctx,
      'log',
      TelemetryData.createAndMarkAsIssued({
        context: category,
        level: LogLevel[1],
        message: telemetryMessage(...extra),
      }),
      1
    );
  }
  sendException(ctx: Context, error: unknown, origin: string) {
    telemetryException(ctx, error, origin);
  }
}

export { TelemetryLogSenderImpl };
