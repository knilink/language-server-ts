import { Context } from './context.ts';
import { NetworkConfiguration } from './networkConfiguration.ts';
import { Fetcher } from './networking.ts';

type Severity = 'critical' | 'not-critical';

type URLToCheck = {
  label: string;
  url: string;
};

type URLReachability = URLToCheck & {
  message: string;
  status: string;
};

function urlsToCheck(ctx: Context): URLToCheck[] {
  const deviceUrl = ctx.get(NetworkConfiguration).getLoginReachabilityUrl();
  const apiUrl = ctx.get(NetworkConfiguration).getAPIUrl();
  const proxyUrl = ctx.get(NetworkConfiguration).getCompletionsUrl(ctx, '_ping');
  const capiUrl = ctx.get(NetworkConfiguration).getCAPIUrl(ctx, '_ping');
  const telemetryUrl = ctx.get(NetworkConfiguration).getTelemetryUrl('_ping');
  function label(url: string) {
    return new URL(url).host;
  }

  return [
    { label: label(deviceUrl), url: deviceUrl },
    { label: label(apiUrl), url: apiUrl },
    { label: label(proxyUrl), url: proxyUrl },
    { label: label(capiUrl), url: capiUrl },
    { label: label(telemetryUrl), url: telemetryUrl },
  ];
}

async function checkReachability(ctx: Context): Promise<URLReachability[]> {
  const reachabilityPromises = urlsToCheck(ctx).map(async ({ label, url }) => {
    let { message: message, status: status } = await determineReachability(ctx, url);
    return { label, url, message, status };
  });
  return await Promise.all(reachabilityPromises);
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
    return { message: String(err), status: 'unreachable' };
  }
}

export { checkReachability, URLReachability };
