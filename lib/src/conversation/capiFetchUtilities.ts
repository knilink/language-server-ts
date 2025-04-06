import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { editorVersionHeaders } from '../config.ts';
import { Context } from '../context.ts';
import { HeaderContributors } from '../headerContributors.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { Fetcher } from '../networking.ts';

async function fetchCapiUrl(ctx: Context, path: string) {
  const token = await ctx.get(CopilotTokenManager).getToken();
  const url = ctx.get(NetworkConfiguration).getCAPIUrl(ctx, path);
  const headers = { Authorization: `Bearer ${token.token}`, ...editorVersionHeaders(ctx) };
  ctx.get(HeaderContributors).contributeHeaders(url, headers);
  return await ctx.get(Fetcher).fetch(new URL(url).href, { method: 'GET', headers: headers });
}

async function postCapiUrl(ctx: Context, path: string, body: string | string) {
  const token = await ctx.get(CopilotTokenManager).getToken();
  const url = ctx.get(NetworkConfiguration).getCAPIUrl(ctx, path);
  const headers = { Authorization: `Bearer ${token.token}`, ...editorVersionHeaders(ctx) };
  ctx.get(HeaderContributors).contributeHeaders(url, headers);
  return await ctx.get(Fetcher).fetch(new URL(url).href, { method: 'POST', headers, body });
}

export { fetchCapiUrl, postCapiUrl };
