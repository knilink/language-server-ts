import { DocumentUri } from 'vscode-languageserver-types';
import { CopilotToken } from '../auth/copilotToken.ts';
import { Context } from '../context.ts';
import { Logger } from '../logger.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { ConfigKey, getConfig } from '../config.ts';
import { Features } from '../experiments/features.ts';
import { TelemetryWithExp } from '../telemetry.ts';

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
  constructor(readonly token: CopilotToken) {}

  getModelIds(): string[] {
    return [...(this.token.getTokenValue('cml')?.split(',') ?? []), DefaultModelId];
  }

  async getModelForResource(
    ctx: Context,
    uri: DocumentUri,
    featureSettings?: TelemetryWithExp
  ): Promise<ModelRequestInfo> {
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
  constructor(
    readonly modelId: string,
    readonly forceBaseModel = false
  ) {}

  get path(): string {
    return `/v1/engines/${encodeURIComponent(this.modelId)}`;
  }

  get headers(): Record<string, string> {
    return this.forceBaseModel ? { 'X-Custom-Model': 'disable' } : {};
  }
}

export { AvailableModelManager, AvailableModels, ModelRequestInfo };
