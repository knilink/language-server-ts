import { Context } from '../context.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { AvailableModelManager } from './model.ts';
import { TelemetryWithExp } from '../telemetry.ts';
import { joinPath } from '../util/uri.ts';

interface RequestInfo {
  url: string;
  headers: Record<string, string>;
  modelId: string;
  engineChoiceSource: string;
}

function getProxyURLWithPath(ctx: Context, path: string): string {
  return ctx.get(NetworkConfiguration).getCompletionsUrl(ctx, path);
}

function getCapiURLWithPath(ctx: Context, path: string): string {
  let capiUrl = ctx.get(NetworkConfiguration).getCAPIUrl(ctx);
  return joinPath(capiUrl, path);
}

async function getEngineRequestInfo(ctx: Context, telemetryData?: TelemetryWithExp): Promise<RequestInfo> {
  const modelRequestInfo = await (
    await ctx.get(AvailableModelManager).getAvailableModels()
  ).getCurrentModelRequestInfo(telemetryData);
  return {
    url: getProxyURLWithPath(ctx, modelRequestInfo.path),
    headers: modelRequestInfo.headers,
    modelId: modelRequestInfo.modelId,
    engineChoiceSource: modelRequestInfo.modelChoiceSource,
  };
}

export { getCapiURLWithPath, getEngineRequestInfo, getProxyURLWithPath };

export type { RequestInfo };
