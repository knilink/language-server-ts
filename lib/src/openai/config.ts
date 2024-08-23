import { URI, Utils } from 'vscode-uri';

import { Context } from '../context';
import { NetworkConfiguration } from '../networkConfiguration';
import { AvailableModelManager } from './model';
import { TelemetryWithExp } from '../telemetry';

function getProxyURLWithPath(ctx: Context, path: string): string {
  return ctx.get<NetworkConfiguration>(NetworkConfiguration).getCompletionsUrl(ctx, path);
}

function getCapiURLWithPath(ctx: Context, path: string): string {
  let capiUrl = ctx.get<NetworkConfiguration>(NetworkConfiguration).getCAPIUrl(ctx);
  return Utils.joinPath(URI.parse(capiUrl), path).toString();
}

async function getEngineRequestInfo(
  ctx: Context,
  // ../ghostText/ghostText.ts document.vscodeUri
  resource: URI, // resource uri
  telemetryData: TelemetryWithExp
): Promise<{ url: string; headers: Record<string, string> }> {
  let selectedModel = await (
    await ctx.get<AvailableModelManager>(AvailableModelManager).getModels(ctx)
  ).getModelForResource(ctx, resource, telemetryData);
  return { url: getProxyURLWithPath(ctx, selectedModel.path), headers: selectedModel.headers };
}
export { getCapiURLWithPath, getEngineRequestInfo };
