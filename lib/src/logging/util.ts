import * as util from 'util';
import type { Context } from '../context.ts';
import { isVerboseLoggingEnabled } from '../testing/runtimeMode.ts';

function formatLogMessage(category: string, ...extra: unknown[]): string {
  return `[${category}] ${format(extra)}`;
}

function format(args: unknown[]): string {
  return util.formatWithOptions({ maxStringLength: +Infinity }, ...args);
}

function verboseLogging(ctx: Context): boolean {
  return isVerboseLoggingEnabled(ctx);
}

export { formatLogMessage, verboseLogging };
