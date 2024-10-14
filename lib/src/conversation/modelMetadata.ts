import { Unknown, PromptType, Model } from '../types.ts';
import { Context } from '../context.ts';

import { fetchCapiUrl } from './capiFetchUtilities.ts';
import { conversationLogger } from './logger.ts';
import { Features } from '../experiments/features.ts';
import { logger } from '../logger.ts';
import { FetchResponseError, type Response } from '../networking.ts';

const tenMinutesMs = 600_000;

enum ChatModelFamily {
  Gpt35turbo = 'gpt-3.5-turbo',
  Gpt4 = 'gpt-4',
  Gpt4turbo = 'gpt-4-turbo',
  Gpt4o = 'gpt-4o',
  Gpt4oMini = 'gpt-4o-mini',
  TextEmbedding3Small = 'text-embedding-3-small',
  TextEmbeddingAda002 = 'text-embedding-ada-002',
  Unknown = 'unknown',
}

function getSupportedModelFamiliesForPrompt(promptType: PromptType): ChatModelFamily[] {
  switch (promptType) {
    case 'user':
    case 'inline':
      return [ChatModelFamily.Gpt4o, ChatModelFamily.Gpt4turbo, ChatModelFamily.Gpt4];
    case 'meta':
    case 'suggestions':
    case 'synonyms':
      return [ChatModelFamily.Gpt4oMini, ChatModelFamily.Gpt35turbo];
  }
}

abstract class ModelMetadataProvider {
  abstract getMetadata(): Promise<Model.Metadata[]>;
}

class CapiModelMetadataProvider extends ModelMetadataProvider {
  private _metadata: Model.Metadata[] = [];
  private _lastFetchTime: number = 0;

  constructor(readonly ctx: Context) {
    super();
  }

  async getMetadata(): Promise<Model.Metadata[]> {
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

  async fetchModel(modelId: string): Promise<Model.Metadata | undefined> {
    const response = await fetchCapiUrl(this.ctx, `/models/${modelId}`);
    if (!response.ok) {
      logger.error(this.ctx, `Failed to fetch model ${modelId} from CAPI`, {
        status: response.status,
        statusText: response.statusText,
      });
      return;
    }
    return (await response.json()) as Model.Metadata;
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
  _exp_models_cache = new Map<string, [Model.Metadata, number]>();

  constructor(
    readonly ctx: Context,
    readonly delegate: CapiModelMetadataProvider
  ) {
    super();
  }

  async getMetadata(): Promise<Model.Metadata[]> {
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

  async fetchModel(modelId: string): Promise<Model.Metadata | undefined> {
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
}

export {
  CapiModelMetadataProvider,
  ChatModelFamily,
  ExpModelMetadataProvider,
  ModelMetadataProvider,
  getSupportedModelFamiliesForPrompt,
};
