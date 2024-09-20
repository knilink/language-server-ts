import { Unknown, PromptType, Model } from '../types.ts';
import { Context } from '../context.ts';

import { fetchCapiUrl } from './capiFetchUtilities.ts';
import { conversationLogger } from './logger.ts';
import { Features } from '../experiments/features.ts';
import { logger } from '../logger.ts';
import { FetchResponseError, type Response } from '../networking.ts';

enum ChatModelFamily {
  Gpt35turbo = 'gpt-3.5-turbo',
  Gpt4 = 'gpt-4',
  Gpt4turbo = 'gpt-4-turbo',
  Gpt4o = 'gpt-4o',
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
      return [ChatModelFamily.Gpt35turbo];
  }
}

function pickModelMetadataProvider(ctx: Context): ModelMetadataProvider {
  try {
    if (process.env.CAPI_MODEL_METADATA_OVERRIDE) {
      const parsedModelMetadata = JSON.parse(process.env.CAPI_MODEL_METADATA_OVERRIDE);
      return new StaticModelMetadataProvider(parsedModelMetadata);
    }
  } catch (e: unknown) {
    conversationLogger.error(ctx, 'Failed to parse models from CAPI', { error: e });
  }

  return new ExpModelMetadataProvider(ctx, new CapiModelMetadataProvider(ctx));
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
    return Date.now() - this._lastFetchTime > 600_000;
  }
}

class StaticModelMetadataProvider extends ModelMetadataProvider {
  constructor(private metadata: Model.Metadata[]) {
    super();
  }

  async getMetadata(): Promise<Model.Metadata[]> {
    return this.metadata;
  }
  async fetchModel(modelId: string) {
    throw new Error('StaticModelMetadataProvider cannot fetch models');
  }
}

class ExpModelMetadataProvider extends ModelMetadataProvider {
  constructor(
    readonly ctx: Context,
    private delegate: CapiModelMetadataProvider
  ) {
    super();
  }

  async getMetadata(): Promise<Model.Metadata[]> {
    const features = this.ctx.get(Features);
    const telemetryDataWithExp = await features.updateExPValuesAndAssignments();
    const expModelId = features.ideChatExpModelId(telemetryDataWithExp);
    const experimentalModels = [];
    if (expModelId) {
      const expModelMetadata = await this.fetchModel(expModelId);

      if (expModelMetadata !== undefined) {
        expModelMetadata.isExperimental = true;
        experimentalModels.push(expModelMetadata);
      }
    }
    return experimentalModels.concat(await this.delegate.getMetadata());
  }

  async fetchModel(modelId: string) {
    return this.delegate.fetchModel(modelId);
  }
}

export { getSupportedModelFamiliesForPrompt, pickModelMetadataProvider, ModelMetadataProvider, ChatModelFamily };
