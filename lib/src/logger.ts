import util from 'node:util';
import { TelemetryStore } from './types.ts';

import { Context } from './context.ts';
import { telemetryError, telemetryException, TelemetryData } from './telemetry.ts';
import { isProduction, getConfig, ConfigKey } from './config.ts';
import { isVerboseLoggingEnabled } from './testing/runtimeMode.ts';

function verboseLogging(ctx: Context): boolean {
  return isVerboseLoggingEnabled(ctx);
}

function format(...args: Parameters<typeof util.format>): ReturnType<typeof util.format> {
  return util.format(...args);
}

enum LogLevel {
  DEBUG = 4,
  INFO = 3,
  WARN = 2,
  ERROR = 1,
}

abstract class LogTarget {
  shouldLog(ctx: Context, level: LogLevel): boolean | undefined {
    return undefined; // Placeholder logic
  }
  abstract logIt(ctx: Context, level: LogLevel, metadataStr: string, ...extra: any[]): void;
}

class ConsoleLog extends LogTarget {
  constructor(readonly console: Console) {
    super();
  }

  logIt(ctx: Context, level: LogLevel, metadataStr: string, ...extra: any[]) {
    if (level === LogLevel.ERROR) {
      this.console.error(metadataStr, ...extra);
    } else if (level === LogLevel.WARN || verboseLogging(ctx)) {
      this.console.warn(metadataStr, ...extra);
    }
  }
}

class Logger {
  constructor(
    public maxLoggedLevel: LogLevel = LogLevel.DEBUG,
    readonly context: string = 'default'
  ) {}

  setLevel(level: LogLevel): void {
    this.maxLoggedLevel = level;
  }

  stringToLevel(s: keyof typeof LogLevel): LogLevel {
    return LogLevel[s];
  }

  log(ctx: Context, level: LogLevel, ...extra: unknown[]): void {
    const logTarget = ctx.get(LogTarget);
    const targetOverride = logTarget.shouldLog(ctx, level);

    if (targetOverride === false || (targetOverride === undefined && !this.shouldLog(ctx, level, this.context))) return;

    const metadataStr = `[${this.context}]`;
    logTarget.logIt(ctx, level, metadataStr, ...extra);
  }

  sendErrorTelemetry(ctx: Context, name: string, secureMessage: any): void {
    telemetryError(
      ctx,
      name,
      TelemetryData.createAndMarkAsIssued({
        context: this.context,
        level: LogLevel[LogLevel.ERROR],
        message: secureMessage,
      }),
      TelemetryStore.RESTRICTED
    );
    this.errorWithoutTelemetry(ctx, ...arguments);
  }

  private telemetryMessage(...extra: unknown[]): string {
    return extra.length > 0 ? JSON.stringify(extra) : 'no msg';
  }

  private shouldLog(ctx: Context, level: LogLevel, category: string): boolean {
    if (verboseLogging(ctx)) return true;
    let levels = getConfig(ctx, ConfigKey.DebugFilterLogCategories);
    // EDITED
    if (levels && !levels.includes(category)) return false;
    if (isProduction(ctx)) return level <= this.maxLoggedLevel;
    const overrides: any | undefined = getConfig(ctx, ConfigKey.DebugOverrideLogLevels);
    const maxLevel =
      // EDITED
      this.stringToLevel(overrides?.['*']) ?? this.stringToLevel(overrides[this.context]) ?? this.maxLoggedLevel;
    return level <= maxLevel;
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
    this.sendErrorTelemetry(ctx, 'log', this.telemetryMessage(...extra));
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
      origin = `${this.context}${origin}`;
    }

    telemetryException(ctx, error, origin);

    const safeError = error instanceof Error ? error : new Error('Non-error thrown: ' + error);
    this.log(ctx, LogLevel.ERROR, `${message}:`, safeError);
  }
}

const logger = new Logger(LogLevel.INFO, 'default');

export { format, LogLevel, logger, Logger, ConsoleLog, LogTarget, verboseLogging };
