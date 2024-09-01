import * as util from 'util';

import { Context } from "../context.ts";
import { getBuildType } from "../config.ts";
import { LogLevel, LogTarget } from "../logger.ts";

function createConsole(ctx: Context): Console {
  const c = new console.Console(process.stderr, process.stderr);

  function logIt(level: number, ...args: unknown[]): void {
    if (getBuildType(ctx) === 'dev') {
      return ctx.get<LogTarget>(LogTarget).logIt(ctx, level, '[console]', ...args);
    }
  }

  c.debug = (...args: unknown[]) => logIt(LogLevel.DEBUG, ...args);
  c.info = (...args: unknown[]) => logIt(LogLevel.INFO, ...args);
  c.warn = (...args: unknown[]) => logIt(LogLevel.WARN, ...args);
  c.error = (...args: unknown[]) => logIt(LogLevel.ERROR, ...args);
  c.assert = (condition: boolean, ...args: unknown[]) => {
    if (!condition) {
      args.length === 0 ? logIt(LogLevel.WARN, 'Assertion failed') : logIt(LogLevel.WARN, 'Assertion failed:', ...args);
    }
  };
  c.dir = (obj: unknown, options?: util.InspectOptions) => logIt(LogLevel.DEBUG, util.inspect(obj, options));
  c.log = c.debug;
  c.trace = (...args: unknown[]) => {
    const e = new Error(util.format(...args));
    e.name = 'Trace';
    c.log(e);
  };

  return c;
}

export { createConsole };
