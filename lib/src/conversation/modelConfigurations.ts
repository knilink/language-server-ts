import { Model } from '../types.ts';

import { Context } from '../context.ts';
import { Features } from '../experiments/features.ts';
// import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { conversationLogger } from './logger.ts';
import { ChatModelFamily, ChatModelFamilyValues, ModelMetadataProvider, ModelMetadataType } from './modelMetadata.ts';

type ModelFilter = Pick<ModelMetadataType['capabilities'], 'type' | 'family' | 'supports'>;

async function getExpRequestTokens(ctx: Context, modelMetadata: ModelMetadataType): Promise<number> {
  const features = ctx.get(Features);
  const telemetryDataWithExp = await features.updateExPValuesAndAssignments();
  let maxRequestTokens = features.ideChatMaxRequestTokens(telemetryDataWithExp);

  if (maxRequestTokens === -1) {
    maxRequestTokens = 16384;
  }

  return getRequestTokens(maxRequestTokens, modelMetadata);
}

function getRequestTokens(limit: number, modelMetadata: ModelMetadataType): number {
  return modelMetadata.capabilities.limits?.max_prompt_tokens
    ? Math.min(limit, modelMetadata.capabilities.limits.max_prompt_tokens)
    : limit;
}

function getResponseTokens(limit: number, modelMetadata: ModelMetadataType): number {
  return modelMetadata.capabilities.limits?.max_output_tokens
    ? Math.min(limit, modelMetadata.capabilities.limits.max_output_tokens)
    : limit;
}

function filterModelsByCapabilities<T extends ModelMetadataType>(models: T[], filter: ModelFilter): T[] {
  return models.filter((model) => {
    if (model.capabilities.type !== filter.type || model.capabilities.family !== filter.family) return false;
    if (model.capabilities.supports === undefined || filter.supports === undefined) return true;

    return Object.keys(filter.supports).every(
      (key) => (filter.supports as any)?.[key] === (model.capabilities.supports as any)?.[key] // MARK
    );
  });
}

abstract class ModelConfigurationProvider {
  // ./turnSuggestions.ts
  abstract getBestChatModelConfig(
    modelFamilies: ChatModelFamilyValues[],
    // optional ./skills/projectContextSnippetProviders/localSnippets/ChunkingHandler.ts
    supports?: Model.Supports
  ): Promise<Model.Configuration>;
  abstract getFirstMatchingEmbeddingModelConfiguration(
    modelFamily: string
  ): Promise<Model.EmbeddingModelConfig | undefined>;
}

class DefaultModelConfigurationProvider extends ModelConfigurationProvider {
  constructor(readonly ctx: Context) {
    super();
  }

  async getBestChatModelConfig(
    modelFamilies: ChatModelFamilyValues[],
    supports?: Model.Supports
  ): Promise<Model.Configuration> {
    const matchingConfigurations: Model.Configuration[] = [];
    for (const modelFamily of modelFamilies) {
      const modelConfig = await this.getFirstMatchingChatModelConfiguration(modelFamily, supports);
      if (modelConfig) {
        matchingConfigurations.push(modelConfig);
      }
    }

    if (matchingConfigurations.length > 0) {
      const experimentalModel = matchingConfigurations.find((c) => c.isExperimental);
      return experimentalModel || matchingConfigurations[0];
    }

    conversationLogger.error(
      this.ctx,
      `No model configuration found for families: ${modelFamilies.join(', ')}. Available models: ${JSON.stringify(await this.ctx.get(ModelMetadataProvider).getMetadata())}`
    );
    throw new Error('No model configuration found');
  }

  async getFirstMatchingModelMetadata(filter: ModelFilter): Promise<ModelMetadataType | undefined> {
    const modelsMetadata = await this.ctx.get(ModelMetadataProvider).getMetadata();
    const filteredModelsMetadata = filterModelsByCapabilities(modelsMetadata, filter);
    if (filteredModelsMetadata.length > 0) return filteredModelsMetadata[0];
  }

  async getFirstMatchingChatModelConfiguration(
    modelFamily: ChatModelFamilyValues,
    supports?: Model.Supports
  ): Promise<Model.Configuration | undefined> {
    const modelMetadata = await this.getFirstMatchingModelMetadata({
      family: modelFamily,
      type: 'chat',
      supports,
    });
    if (modelMetadata) {
      switch (modelFamily) {
        case 'gpt-3.5-turbo':
        case 'gpt-4o-mini':
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily,
            maxRequestTokens: getRequestTokens(6144, modelMetadata),
            maxResponseTokens: getResponseTokens(2048, modelMetadata),
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: modelMetadata.capabilities.tokenizer,
            isExperimental: modelMetadata.isExperimental ?? false,
          };
        case 'gpt-4':
        case 'gpt-4-turbo':
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily,
            maxRequestTokens: getRequestTokens(10240, modelMetadata),
            maxResponseTokens: getResponseTokens(4096, modelMetadata),
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: modelMetadata.capabilities.tokenizer,
            isExperimental: modelMetadata.isExperimental ?? false,
          };
        case 'o1-mini':
        case 'o1-ga':
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily,
            maxRequestTokens: getRequestTokens(0, modelMetadata),
            maxResponseTokens: getResponseTokens(0, modelMetadata),
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: modelMetadata.capabilities.tokenizer,
            isExperimental: modelMetadata.isExperimental ?? false,
          };
        case 'o3-mini':
        case 'gemini-2.0-flash':
        case 'claude-3.5-sonnet':
        case 'claude-3.7-sonnet':
        case 'gpt-4.5':
        case 'gpt-4o':
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily,
            maxRequestTokens: await getExpRequestTokens(this.ctx, modelMetadata),
            maxResponseTokens: getResponseTokens(4096, modelMetadata),
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: modelMetadata.capabilities.tokenizer,
            isExperimental: modelMetadata.isExperimental ?? false,
          };
        case 'claude-3.7-sonnet-thought':
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily,
            maxRequestTokens: await getExpRequestTokens(this.ctx, modelMetadata),
            maxResponseTokens: getResponseTokens(8192, modelMetadata),
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: modelMetadata.capabilities.tokenizer,
            isExperimental: modelMetadata.isExperimental ?? false,
          };
      }
    }
  }

  async getFirstMatchingEmbeddingModelConfiguration(
    modelFamily: 'text-embedding-3-small'
  ): Promise<Model.EmbeddingModelConfig | undefined> {
    const modelMetadata = await this.getFirstMatchingModelMetadata({ family: modelFamily, type: 'embeddings' });
    if (modelMetadata) {
      switch (modelFamily) {
        case 'text-embedding-3-small':
          return {
            modelId: modelMetadata.id,
            modelFamily: modelFamily,
            maxBatchSize: modelMetadata.capabilities.limits?.max_inputs ?? 16,
            maxTokens: 8191,
            tokenizer: 'cl100k_base',
          };
      }
    }
  }
}

export { ModelConfigurationProvider, DefaultModelConfigurationProvider };
