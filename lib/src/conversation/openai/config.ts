import { Context } from '../../context';
import { getCapiURLWithPath } from '../../openai/config';

async function getChatURL(ctx: Context): Promise<string> {
  return getCapiURLWithPath(ctx, '/chat');
}

export { getChatURL };
