import type { Context } from '../context.ts';
import { verboseLogging } from './util.ts';
import { LogTarget, LogLevel } from '../logger.ts';

class ConsoleLog extends LogTarget {
  constructor(readonly console: Console) {
    super();
  }

  logIt(ctx: Context, level: LogLevel, category: string, ...extra: unknown[]) {
    if (level == LogLevel.ERROR) {
      this.console.error(`[${category}]`, ...extra);
    } else {
      if (level == LogLevel.WARN || verboseLogging(ctx)) {
        this.console.warn(`[${category}]`, ...extra);
      }
    }
  }
}

export { ConsoleLog };
