import { Unknown, PromptType, Model } from "../types.ts";
import { Context } from "../context.ts";

import { NetworkConfiguration } from "../networkConfiguration.ts";
import { logger } from "../logger.ts";
import { HeaderContributors } from "../headerContributors.ts";
import { CopilotTokenManager } from "../auth/copilotTokenManager.ts";
import { conversationLogger } from "./logger.ts";
import { editorVersionHeaders } from "../config.ts";
import { Fetcher, FetchResponseError, Response } from "../networking.ts";
import { Features } from "../experiments/features.ts";

enum ChatModelFamily {
  Gpt35turbo = 'gpt-3.5-turbo',
  Gpt4 = 'gpt-4',
  Gpt4turbo = 'gpt-4-turbo',
  Gpt4o = 'gpt-4o',
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

function createChatModelMetadataFromExpValues(modelId: string, modelFamily: ChatModelFamily): Model.Metadata[] {
  return [
    {
      id: modelId,
      name: 'GPT Experimental Model',
      version: `exp-${modelId}`,
      capabilities: { type: 'chat', family: modelFamily },
      isExperimental: true,
    },
  ];
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

  private async fetchMetadata() {
    const modelsUrl = this.ctx.get(NetworkConfiguration).getCAPIUrl(this.ctx, '/models');
    const headers = {
      Authorization: `Bearer ${(await this.ctx.get(CopilotTokenManager).getCopilotToken(this.ctx)).token}`,
      ...editorVersionHeaders(this.ctx),
    };
    this.ctx.get(HeaderContributors).contributeHeaders(modelsUrl, headers);
    const response = await this.ctx.get(Fetcher).fetch(new URL(modelsUrl).href, { method: 'GET', headers: headers });
    if (!response.ok) {
      logger.error(this.ctx, 'Failed to fetch models from CAPI', {
        status: response.status,
        statusText: response.statusText,
      });
      throw new FetchResponseError(response);
    }
    await this.processModels(response);
  }

  async processModels(response: Response) {
    try {
      let json = await response.json();
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
    const telemetryDataWithExp = await features.updateExPValuesAndAssignments(this.ctx);
    const expModelId = features.ideChatExpModelId(telemetryDataWithExp);
    const expModelFamily = features.ideChatExpModelFamily(telemetryDataWithExp);
    let experimentalModels: Model.Metadata[] = [];

    if (expModelId && expModelFamily) {
      experimentalModels = createChatModelMetadataFromExpValues(expModelId, expModelFamily);
    }

    return [...experimentalModels, ...(await this.delegate.getMetadata())];
  }
}

export { getSupportedModelFamiliesForPrompt, pickModelMetadataProvider, ModelMetadataProvider, ChatModelFamily };
