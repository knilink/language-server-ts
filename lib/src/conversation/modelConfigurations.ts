import { Model } from '../types.ts';

import { Context } from '../context.ts';
import { Features } from '../experiments/features.ts';
// import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { conversationLogger } from './logger.ts';
import { ChatModelFamily, ModelMetadataProvider } from './modelMetadata.ts';

async function getDefaultRequestTokens(ctx: Context, modelMetadata: Model.Metadata): Promise<number> {
  let features = ctx.get(Features);
  let telemetryDataWithExp = await features.updateExPValuesAndAssignments();
  let maxRequestTokens = features.ideChatMaxRequestTokens(telemetryDataWithExp);

  if (maxRequestTokens === -1) {
    maxRequestTokens = 10240;
  }

  if (modelMetadata.capabilities.limits?.max_prompt_tokens) {
    maxRequestTokens = Math.min(maxRequestTokens, modelMetadata.capabilities.limits.max_prompt_tokens);
  }

  return maxRequestTokens;
}

type ModelFilter = Pick<Model.Metadata['capabilities'], 'type' | 'family' | 'supports'>;

function filterModelsByCapabilities<T extends Model.Metadata>(models: T[], filter: ModelFilter): T[] {
  return models.filter((model) => {
    if (model.capabilities.type !== filter.type || model.capabilities.family !== filter.family) return false;
    if (model.capabilities.supports === undefined || filter.supports === undefined) return true;
    return Object.keys(filter.supports).every((key) => filter.supports?.[key] === model.capabilities.supports?.[key]);
  });
}

abstract class ModelConfigurationProvider {
  // ./turnSuggestions.ts
  abstract getBestChatModelConfig(
    modelFamilies: ChatModelFamily[],
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
    modelFamilies: ChatModelFamily[],
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

  async getFirstMatchingModelMetadata(filter: ModelFilter): Promise<Model.Metadata | undefined> {
    const modelsMetadata = await this.ctx.get(ModelMetadataProvider).getMetadata();
    const filteredModelsMetadata = filterModelsByCapabilities(modelsMetadata, filter);
    if (filteredModelsMetadata.length > 0) return filteredModelsMetadata[0];
  }

  async getFirstMatchingChatModelConfiguration(
    modelFamily: ChatModelFamily,
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
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily,
            maxRequestTokens: 6144,
            maxResponseTokens: 2048,
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: 'cl100k_base',
            isExperimental: modelMetadata.isExperimental ?? false,
          };
        case 'gpt-4':
        case 'gpt-4-turbo': {
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily: modelFamily,
            maxRequestTokens: await getDefaultRequestTokens(this.ctx, modelMetadata),
            maxResponseTokens: 4096,
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: 'cl100k_base',
            isExperimental: modelMetadata.isExperimental ?? false,
          };
        }
        case 'gpt-4o': {
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily: modelFamily,
            maxRequestTokens: await getDefaultRequestTokens(this.ctx, modelMetadata),
            maxResponseTokens: 4096,
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: 'o200k_base',
            isExperimental: modelMetadata.isExperimental ?? false,
          };
        }
      }
    }
  }

  async getFirstMatchingEmbeddingModelConfiguration(
    modelFamily: ChatModelFamily
  ): Promise<Model.EmbeddingModelConfig | undefined> {
    const modelMetadata = await this.getFirstMatchingModelMetadata({ family: modelFamily, type: 'embeddings' });
    if (modelMetadata) {
      switch (modelFamily) {
        case 'text-embedding-3-small':
        case 'text-embedding-ada-002':
          return {
            modelId: modelMetadata.id,
            modelFamily: modelFamily,
            maxBatchSize: Math.min(16, modelMetadata.capabilities.limits?.max_inputs ?? 2048),
            maxTokens: 8191,
            tokenizer: 'cl100k_base',
          };
      }
    }
  }
}

export { ModelConfigurationProvider, DefaultModelConfigurationProvider };
