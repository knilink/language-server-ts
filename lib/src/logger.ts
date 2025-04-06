import type { Context } from './context.ts';

enum LogLevel {
  DEBUG = 4,
  INFO = 3,
  WARN = 2,
  ERROR = 1,
}

abstract class LogTarget {
  // abstract shouldLog(ctx: Context, level: LogLevel): boolean | undefined;
  abstract logIt(ctx: Context, level: LogLevel, metadataStr: string, ...extra: any[]): void;
}

abstract class TelemetryLogSender {
  abstract sendError(ctx: Context, category: string, ...extra: unknown[]): void;
  abstract sendException(ctx: Context, error: unknown, origin: string): void;
}

class Logger {
  constructor(public category: string) {}
  log(ctx: Context, level: LogLevel, ...extra: unknown[]): void {
    ctx.get(LogTarget).logIt(ctx, level, this.category, ...extra);
  }
  debug(ctx: Context, ...extra: unknown[]) {
    this.log(ctx, LogLevel.DEBUG, ...extra);
  }
  info(ctx: Context, ...extra: unknown[]) {
    this.log(ctx, LogLevel.INFO, ...extra);
  }
  warn(ctx: Context, ...extra: unknown[]) {
    this.log(ctx, LogLevel.WARN, ...extra);
  }
  error(ctx: Context, ...extra: unknown[]) {
    ctx.get(TelemetryLogSender).sendError(ctx, this.category, ...extra);
    this.errorWithoutTelemetry(ctx, ...extra);
  }
  errorWithoutTelemetry(ctx: Context, ...extra: unknown[]): void {
    this.log(ctx, LogLevel.ERROR, ...extra);
  }

  exception(ctx: Context, error: unknown, origin: string): void {
    if (error instanceof Error && error.name === 'Canceled' && error.message === 'Canceled') return;

    let message = origin;

    if (origin.startsWith('.')) {
      message = origin.substring(1);
      origin = `${this.category}${origin}`;
    }

    ctx.get(TelemetryLogSender).sendException(ctx, error, origin);
    let safeError = error instanceof Error ? error : new Error(`Non-error thrown: ${String(error)}`);
    this.log(ctx, 1, `${message}:`, safeError);
  }
}

const logger = new Logger('default');

export { LogLevel, LogTarget, Logger, TelemetryLogSender, logger };
