import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { editorVersionHeaders } from '../config.ts';
import { Context } from '../context.ts';
import { HeaderContributors } from '../headerContributors.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { Fetcher } from '../networking.ts';

async function fetchCapiUrl(ctx: Context, path: string) {
  let url = ctx.get(NetworkConfiguration).getCAPIUrl(ctx, path);
  let headers = {
    Authorization: `Bearer ${(await ctx.get(CopilotTokenManager).getCopilotToken(ctx)).token}`,
    ...editorVersionHeaders(ctx),
  };
  ctx.get(HeaderContributors).contributeHeaders(url, headers);
  return await ctx.get(Fetcher).fetch(new URL(url).href, { method: 'GET', headers: headers });
}

export { fetchCapiUrl };
