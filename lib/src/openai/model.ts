import type { DocumentUri } from 'vscode-languageserver-types';

import type { CopilotToken } from '../auth/copilotToken.ts';
import type { Context } from '../context.ts';
import type { TelemetryWithExp } from '../telemetry.ts';

import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { onCopilotToken } from '../auth/copilotTokenNotifier.ts';
import { ConfigKey, getConfig } from '../config.ts';
import { fetchCapiUrl } from '../conversation/capiFetchUtilities.ts';
import { ModelsMetadataSchema, ModelsMetadataType } from '../conversation/modelMetadata.ts';
import { Features } from '../experiments/features.ts';
import { logger } from '../logger.ts';
import { getUserSelectedModelConfiguration } from '../modelPickerConfiguration.ts';
import { Value } from '@sinclair/typebox/value';

const DefaultModelId = 'copilot-codex';

class AvailableModelManager {
  availableModels?: AvailableModels;

  constructor(readonly _ctx: Context) {
    onCopilotToken(this._ctx, (t) => {
      this.refreshAvailableModels(t);
    });
  }

  refreshAvailableModels(token: CopilotToken) {
    this.availableModels = new AvailableModels(this._ctx, token);
    return this.availableModels;
  }

  async getAvailableModels() {
    if (!this.availableModels) {
      const token = await this._ctx.get(CopilotTokenManager).getToken();
      return this.refreshAvailableModels(token);
    }
    return this.availableModels;
  }
}

class AvailableModels {
  readonly customModels: string[];
  readonly editorPreviewFeaturesDisabled: boolean;
  fetchedModelData?: ModelsMetadataType['data'];

  constructor(
    readonly _ctx: Context,
    readonly token: CopilotToken
  ) {
    this.customModels = this.token.getTokenValue('cml')?.split(',') ?? [];
    this.editorPreviewFeaturesDisabled = this.token.getTokenValue('editor_preview_features') == '0';
  }

  async parseModelsResponse(json: unknown) {
    try {
      return Value.Parse(ModelsMetadataSchema, json);
    } catch (error) {
      logger.exception(this._ctx, error, 'Failed to parse /models response from CAPI');
      return;
    }
  }

  async fetchModels(): Promise<ModelsMetadataType['data']> {
    if (this.fetchedModelData) {
      return this.fetchedModelData;
    }
    let response = await fetchCapiUrl(this._ctx, '/models');
    if (response.ok) {
      {
        const result = (await this.parseModelsResponse(await response.json()))?.data ?? [];
        this.fetchedModelData = result;
        return result;
      }
    } else {
      logger.error(this._ctx, 'Failed to fetch models from CAPI', {
        status: response.status,
        statusText: response.statusText,
      });
      return [];
    }
  }

  async getGenericCompletionModels() {
    let filteredResult = AvailableModels.filterCompletionModels(
      await this.fetchModels(),
      this.editorPreviewFeaturesDisabled
    );
    return AvailableModels.mapCompletionModels(filteredResult);
  }

  static filterCompletionModels(data: ModelsMetadataType['data'], editorPreviewFeaturesDisabled: boolean) {
    return data
      .filter((item) => item.capabilities.type === 'completion')
      .filter((item) => !editorPreviewFeaturesDisabled || item.preview === false || item.preview === undefined);
  }

  static mapCompletionModels(data: ModelsMetadataType['data']) {
    return data.map((item) => ({ modelId: item.id, label: item.name, preview: !!item.preview }));
  }

  async getCurrentModelRequestInfo(featureSettings?: TelemetryWithExp) {
    let userSelectedCompletionModel = getUserSelectedModelConfiguration(this._ctx);
    if (userSelectedCompletionModel) {
      const genericModels = (await this.getGenericCompletionModels()).map((model) => model.modelId);

      if (!genericModels.includes(userSelectedCompletionModel)) {
        logger.error(
          this._ctx,
          `User selected model ${userSelectedCompletionModel} is not in the list of generic models: ${genericModels.join(', ')}, falling back to default model.`
        );
        userSelectedCompletionModel = null;
      }
    }
    let debugOverride =
      getConfig(this._ctx, ConfigKey.DebugOverrideEngine) || getConfig(this._ctx, ConfigKey.DebugOverrideEngineLegacy);
    if (debugOverride) {
      return new ModelRequestInfo(debugOverride, DefaultModelId === debugOverride, 'override');
    }
    const customEngine = featureSettings ? this._ctx.get(Features).customEngine(featureSettings) : '';
    const targetEngine = featureSettings
      ? this._ctx.get(Features).customEngineTargetEngine(featureSettings)
      : undefined;

    if (userSelectedCompletionModel) {
      if (customEngine && targetEngine && userSelectedCompletionModel === targetEngine) {
        return new ModelRequestInfo(customEngine, DefaultModelId === customEngine, 'exp');
      } else {
        return new ModelRequestInfo(
          userSelectedCompletionModel,
          DefaultModelId === userSelectedCompletionModel,
          'modelpicker'
        );
      }
    } else {
      if (customEngine) {
        return new ModelRequestInfo(customEngine, DefaultModelId === customEngine, 'exp');
      } else {
        if (this.customModels.length > 0) {
          return new ModelRequestInfo(this.customModels[0], false, 'custommodel');
        } else {
          return new ModelRequestInfo(DefaultModelId, false, 'default');
        }
      }
    }
  }
}

class ModelRequestInfo {
  constructor(
    readonly modelId: string,
    readonly forceBaseModel = false,
    readonly modelChoiceSource: 'default' | 'custommodel' | 'exp' | 'override' | 'modelpicker'
  ) {}

  get path(): string {
    return `/v1/engines/${encodeURIComponent(this.modelId)}`;
  }

  get headers(): Record<string, string> {
    return this.forceBaseModel ? { 'X-Custom-Model': 'disable' } : {};
  }
}

export { AvailableModelManager, AvailableModels };
