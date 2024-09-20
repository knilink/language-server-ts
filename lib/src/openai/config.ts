import type { URI } from 'vscode-uri';

import { Context } from '../context.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { AvailableModelManager } from './model.ts';
import { TelemetryWithExp } from '../telemetry.ts';
import { joinPath } from '../util/uri.ts';
import { DocumentUri } from 'vscode-languageserver-types';

function getProxyURLWithPath(ctx: Context, path: string): string {
  return ctx.get(NetworkConfiguration).getCompletionsUrl(ctx, path);
}

function getCapiURLWithPath(ctx: Context, path: string): string {
  let capiUrl = ctx.get(NetworkConfiguration).getCAPIUrl(ctx);
  return joinPath(capiUrl, path);
}

async function getEngineRequestInfo(
  ctx: Context,
  // ../ghostText/ghostText.ts document.vscodeUri
  resource: DocumentUri, // resource uri
  telemetryData: TelemetryWithExp
): Promise<{ url: string; headers: Record<string, string> }> {
  const selectedModel = await (
    await ctx.get(AvailableModelManager).getModels(ctx)
  ).getModelForResource(ctx, resource, telemetryData);
  return { url: getProxyURLWithPath(ctx, selectedModel.path), headers: selectedModel.headers };
}
export { getCapiURLWithPath, getEngineRequestInfo };
