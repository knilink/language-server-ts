import { Context } from '../../context.ts';
import { getCapiURLWithPath } from '../../openai/config.ts';

async function getChatURL(ctx: Context): Promise<string> {
  return getCapiURLWithPath(ctx, '/chat');
}

export { getChatURL };
