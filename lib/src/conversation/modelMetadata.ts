import { Type, type Static } from '@sinclair/typebox';
import { PromptType } from '../types.ts';
import { Context } from '../context.ts';

import { fetchCapiUrl, postCapiUrl } from './capiFetchUtilities.ts';
import { Features } from '../experiments/features.ts';
import { logger } from '../logger.ts';
import { FetchResponseError, type Response } from '../networking.ts';

const tenMinutesMs = 600_000;

function parseModel(model: string): ChatModelFamily[] {
  return isKnownModelFamily(model) ? [model] : [];
}

function isKnownModelFamily(model: string): model is ChatModelFamily {
  return Object.values(ChatModelFamily).includes(model as ChatModelFamily);
}

enum ChatModelFamily {
  Gpt35turbo = 'gpt-3.5-turbo',
  Gpt4 = 'gpt-4',
  Gpt4turbo = 'gpt-4-turbo',
  Gpt4o = 'gpt-4o',
  Gpt4oMini = 'gpt-4o-mini',
  O1Mini = 'o1-mini',
  O1Ga = 'o1-ga',
  Claude35Sonnet = 'claude-3.5-sonnet',
  O3Mini = 'o3-mini',
  Gemini20Flash = 'gemini-2.0-flash',
  Claude37Sonnet = 'claude-3.7-sonnet',
  Claude37SonnetThought = 'claude-3.7-sonnet-thought',
  Gpt45 = 'gpt-4.5',
  Unknown = 'unknown',
}

type ChatModelFamilyValues = `${ChatModelFamily}`;

function getSupportedModelFamiliesForPrompt(promptType: PromptType): ChatModelFamilyValues[] {
  switch (promptType) {
    case 'user':
    case 'inline':
      return [
        'gpt-4o',
        'gpt-4-turbo',
        'gpt-4',
        'o1-mini',
        'o1-ga',
        'claude-3.5-sonnet',
        'o3-mini',
        'gemini-2.0-flash',
        'claude-3.7-sonnet',
        'claude-3.7-sonnet-thought',
        'gpt-4.5',
      ];
    case 'meta':
    case 'suggestions':
    case 'synonyms':
      return ['gpt-4o-mini', 'gpt-3.5-turbo'];
  }
}

const ModelCapabilitiesSchema = Type.Object({
  type: Type.Union([Type.Literal('chat'), Type.Literal('embeddings'), Type.Literal('completion')]),
  tokenizer: Type.String(),
  family: Type.String(),
  object: Type.String(),
  supports: Type.Optional(
    Type.Object({ tool_calls: Type.Optional(Type.Boolean()), parallel_tool_calls: Type.Optional(Type.Boolean()) })
  ),
  limits: Type.Optional(
    Type.Object({
      max_inputs: Type.Optional(Type.Number()),
      max_prompt_tokens: Type.Optional(Type.Number()),
      max_output_tokens: Type.Optional(Type.Number()),
      max_context_window_tokens: Type.Optional(Type.Number()),
    })
  ),
});
type ModelCapabilitiesType = Static<typeof ModelCapabilitiesSchema>;

const ModelMetadataSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  version: Type.String(),
  model_picker_enabled: Type.Boolean(),
  capabilities: ModelCapabilitiesSchema,
  object: Type.String(),
  preview: Type.Optional(Type.Boolean()),
  isExperimental: Type.Optional(Type.Boolean()),
  policy: Type.Optional(Type.Object({ state: Type.String(), terms: Type.String() })),
});
type ModelMetadataType = Static<typeof ModelMetadataSchema>;

const ModelsMetadataSchema = Type.Object({ data: Type.Array(ModelMetadataSchema) });
type ModelsMetadataType = Static<typeof ModelsMetadataSchema>;

abstract class ModelMetadataProvider {
  abstract getMetadata(): Promise<ModelMetadataType[]>;
  abstract acceptModelPolicy(modelId: string): Promise<boolean>;
}

class CapiModelMetadataProvider extends ModelMetadataProvider {
  private _metadata: ModelMetadataType[] = [];
  private _lastFetchTime: number = 0;

  constructor(readonly ctx: Context) {
    super();
  }

  async getMetadata(): Promise<ModelMetadataType[]> {
    if (this.shouldRefreshModels()) {
      await this.fetchMetadata();
    }
    return [...this._metadata];
  }

  async fetchMetadata() {
    const response = await fetchCapiUrl(this.ctx, '/models');
    if (!response.ok) {
      logger.error(this.ctx, 'Failed to fetch models from CAPI', {
        status: response.status,
        statusText: response.statusText,
      });
      throw new FetchResponseError(response);
    }
    await this.processModels(response);
  }

  async fetchModel(modelId: string): Promise<ModelMetadataType | undefined> {
    const response = await fetchCapiUrl(this.ctx, `/models/${modelId}`);
    if (!response.ok) {
      logger.error(this.ctx, `Failed to fetch model ${modelId} from CAPI`, {
        status: response.status,
        statusText: response.statusText,
      });
      return;
    }
    return (await response.json()) as ModelMetadataType;
  }

  async acceptModelPolicy(modelId: string) {
    if ((await postCapiUrl(this.ctx, `/models/${modelId}/policy`, JSON.stringify({ status: 'enabled' }))).ok) {
      await this.fetchMetadata();
      return true;
    }
    return false;
  }

  async processModels(response: Response) {
    try {
      const json = await response.json();
      this._metadata = (json as any).data; // MARK
      this._lastFetchTime = Date.now();
    } catch (e) {
      logger.error(this.ctx, 'Failed to parse models from CAPI', { error: e });
    }
  }

  private shouldRefreshModels(): boolean {
    return this._metadata.length === 0 || !this._lastFetchTime || this.isLastFetchOlderTenMinutes();
  }

  private isLastFetchOlderTenMinutes(): boolean {
    return Date.now() - this._lastFetchTime > tenMinutesMs;
  }
}

class ExpModelMetadataProvider extends ModelMetadataProvider {
  _exp_models_cache = new Map<string, [ModelMetadataType, number]>();

  constructor(
    readonly ctx: Context,
    readonly delegate: CapiModelMetadataProvider
  ) {
    super();
  }

  async getMetadata(): Promise<ModelMetadataType[]> {
    const features = this.ctx.get(Features);
    const telemetryDataWithExp = await features.updateExPValuesAndAssignments();
    const expModelIdsStr = features.ideChatExpModelIds(telemetryDataWithExp);
    const experimentalModels = [];
    if (expModelIdsStr) {
      let expModelIds = expModelIdsStr?.split(',');
      for (let modelId of expModelIds) {
        let modelMetadata = await this.fetchModel(modelId.trim());

        if (modelMetadata !== undefined) {
          modelMetadata.isExperimental = true;
          experimentalModels.push(modelMetadata);
        }
      }
    }
    return experimentalModels.concat(await this.delegate.getMetadata());
  }

  async fetchModel(modelId: string): Promise<ModelMetadataType | undefined> {
    const cachedModelData = this._exp_models_cache.get(modelId);
    if (cachedModelData) {
      let [modelMetadata, lastFetchTime] = cachedModelData;
      if (Date.now() - lastFetchTime < tenMinutesMs) {
        return modelMetadata;
      }
    }
    const modelData = await this.delegate.fetchModel(modelId);
    if (modelData) {
      this._exp_models_cache.set(modelId, [modelData, Date.now()]);
      return modelData;
    }
  }

  async acceptModelPolicy(modelId: string) {
    return await this.delegate.acceptModelPolicy(modelId);
  }
}

export {
  CapiModelMetadataProvider,
  ChatModelFamily,
  ExpModelMetadataProvider,
  ModelMetadataProvider,
  ModelsMetadataSchema,
  getSupportedModelFamiliesForPrompt,
  isKnownModelFamily,
  parseModel,
};

export type { ModelMetadataType, ModelCapabilitiesType, ModelsMetadataType, ChatModelFamilyValues };
