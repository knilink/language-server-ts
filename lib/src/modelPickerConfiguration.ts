import type { Context } from './context.ts';
import { ConfigKey, getConfig } from './config.ts';

function getUserSelectedModelConfiguration(ctx: Context): string | null {
  let value = getConfig(ctx, ConfigKey.UserSelectedCompletionModel);
  return typeof value == 'string' && value.length > 0 ? value : null;
}

export { getUserSelectedModelConfiguration };
