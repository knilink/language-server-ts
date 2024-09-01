import { type URI } from 'vscode-uri';

import { CopilotToken } from "../auth/copilotToken.ts";
import { Context } from "../context.ts";
import { Logger } from "../logger.ts";
import { CopilotTokenManager } from "../auth/copilotTokenManager.ts";
import { ConfigKey, getConfig } from "../config.ts";
import { Features } from "../experiments/features.ts";
import { TelemetryWithExp } from "../telemetry.ts";

const DefaultModelId = 'copilot-codex';
const modelLogger = new Logger(4, 'customModels');

class AvailableModelManager {
  async getModels(ctx: Context): Promise<AvailableModels> {
    const token = await ctx.get(CopilotTokenManager).getCopilotToken(ctx);
    return new AvailableModels(token);
  }

  logModelsForToken(ctx: Context, token: CopilotToken): void {
    const allIds = new AvailableModels(token).getModelIds();
    if (allIds.length > 1) {
      allIds.forEach((id) => modelLogger.info(ctx, `Available model: ${id}`));
    }
  }
}

class AvailableModels {
  private token: CopilotToken;

  constructor(token: CopilotToken) {
    this.token = token;
  }

  getModelIds(): string[] {
    return [...(this.token.getTokenValue('cml')?.split(',') ?? []), DefaultModelId];
  }

  async getModelForResource(ctx: Context, uri: URI, featureSettings?: TelemetryWithExp): Promise<ModelRequestInfo> {
    const override: string | undefined = getConfig(ctx, ConfigKey.DebugOverrideEngine);
    if (override) return new ModelRequestInfo(override, DefaultModelId === override);

    if (featureSettings) {
      const expOverride = ctx.get(Features).customEngine(featureSettings);
      if (expOverride) return new ModelRequestInfo(expOverride, DefaultModelId === expOverride);
    }

    const modelIds = this.getModelIds();
    return new ModelRequestInfo(modelIds[0]);
  }
}

class ModelRequestInfo {
  private modelId: string;
  private forceBaseModel: boolean;

  constructor(modelId: string, forceBaseModel = false) {
    this.modelId = modelId;
    this.forceBaseModel = forceBaseModel;
  }

  get path(): string {
    return `/v1/engines/${encodeURIComponent(this.modelId)}`;
  }

  get headers(): Record<string, string> {
    return this.forceBaseModel ? { 'X-Custom-Model': 'disable' } : {};
  }
}

export { AvailableModelManager, AvailableModels, ModelRequestInfo };
