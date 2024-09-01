import { Context } from "./context.ts";
import { NetworkConfiguration } from "./networkConfiguration.ts";
import { Fetcher } from "./networking.ts";

type URLToCheck = {
  label: string;
  url: string;
  severity: 'critical' | 'not-critical';
};

type URLReachability = URLToCheck & {
  message: string;
  status: string;
};

function urlsToCheck(ctx: Context): URLToCheck[] {
  const deviceUrl = ctx.get(NetworkConfiguration).getLoginReachabilityUrl();
  const apiUrl = ctx.get(NetworkConfiguration).getAPIReachabilityUrl();
  const proxyUrl = ctx.get(NetworkConfiguration).getCompletionsUrl(ctx, '_ping');
  const capiUrl = ctx.get(NetworkConfiguration).getCAPIUrl(ctx, '_ping');

  function label(url: string): string {
    return new URL(url).host;
  }

  return [
    { label: label(deviceUrl), url: deviceUrl, severity: 'not-critical' },
    { label: label(apiUrl), url: apiUrl, severity: 'not-critical' },
    { label: label(proxyUrl), url: proxyUrl, severity: 'critical' },
    { label: label(capiUrl), url: capiUrl, severity: 'critical' },
    {
      label: 'default.exp-tas.com',
      url: 'https://default.exp-tas.com/vscode/ab',
      severity: 'not-critical',
    },
  ];
}

async function checkReachability(ctx: Context): Promise<URLReachability[]> {
  const reachabilityPromises = urlsToCheck(ctx).map(async ({ label, url, severity }) => {
    const { message, status } = await determineReachability(ctx, url);
    return { label, url, message, status, severity };
  });

  return Promise.all(reachabilityPromises);
}

async function determineReachability(
  ctx: Context,
  url: string
): Promise<{ message: string; status: 'reachable' | 'unreachable' }> {
  try {
    const response = await ctx.get(Fetcher).fetch(url, {});
    const status = response.status >= 200 && response.status < 400 ? 'reachable' : 'unreachable';
    return {
      message: `HTTP ${response.status}` + (response.statusText ? ` - ${response.statusText}` : ''),
      status,
    };
  } catch (err) {
    return { message: (err as any).message, status: 'unreachable' };
  }
}

export { checkReachability, URLReachability };
