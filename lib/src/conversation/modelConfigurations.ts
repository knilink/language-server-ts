import { Model } from '../types.ts';

import { Context } from '../context.ts';
import { Features } from '../experiments/features.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { conversationLogger } from './logger.ts';
import { ChatModelFamily, ModelMetadataProvider } from './modelMetadata.ts';

async function getGpt4TokenConfig(ctx: Context): Promise<Model.TokenConfiguration> {
  const features = ctx.get(Features);
  const telemetryDataWithExp = await features.updateExPValuesAndAssignments(ctx);
  let maxTokens = features.ideChatGpt4MaxTokens(telemetryDataWithExp);
  let maxRequestTokens = features.ideChatGpt4MaxRequestTokens(telemetryDataWithExp);

  if (maxTokens === -1 || maxRequestTokens === -1) {
    [maxTokens, maxRequestTokens] = await getDefaultValueForGpt4Tokens(ctx);
  }

  if (maxRequestTokens >= maxTokens) {
    maxRequestTokens = Math.floor(maxTokens * 0.8);
  }

  return {
    maxTokens: maxTokens,
    maxRequestTokens: maxRequestTokens,
    maxResponseTokens: maxTokens - maxRequestTokens,
  };
}

async function getDefaultValueForGpt4Tokens(ctx: Context): Promise<[number, number]> {
  const copilotToken = await ctx.get(CopilotTokenManager).getCopilotToken(ctx);
  if (copilotToken?.envelope.copilot_ide_agent_chat_gpt4_small_prompt) {
    return [10240, 8192];
  } else {
    return [16348, 10240];
  }
}

abstract class ModelConfigurationProvider {
  // ./turnSuggestions.ts
  abstract getBestChatModelConfig(modelFamilies: ChatModelFamily[]): Promise<Model.Configuration>;
  abstract getFirstMatchingEmbeddingModelConfiguration(
    modelFamily: string
  ): Promise<Model.EmbeddingModelConfig | undefined>;
}

class DefaultModelConfigurationProvider extends ModelConfigurationProvider {
  constructor(readonly ctx: Context) {
    super();
  }

  async getBestChatModelConfig(modelFamilies: ChatModelFamily[]): Promise<Model.Configuration> {
    const matchingConfigurations: Model.Configuration[] = [];
    for (const modelFamily of modelFamilies) {
      const modelConfig = await this.getFirstMatchingChatModelConfiguration(modelFamily);
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

  async getFirstMatchingModelMetadata(capabilities: {
    family: string;
    type: string;
  }): Promise<Model.Metadata | undefined> {
    const metadata = await this.ctx.get(ModelMetadataProvider).getMetadata();
    return metadata.find(
      (m) => m.capabilities.type === capabilities.type && m.capabilities.family === capabilities.family
    );
  }

  async getFirstMatchingChatModelConfiguration(modelFamily: ChatModelFamily): Promise<Model.Configuration | undefined> {
    const modelMetadata = await this.getFirstMatchingModelMetadata({ family: modelFamily, type: 'chat' });
    if (modelMetadata) {
      switch (modelFamily) {
        case 'gpt-3.5-turbo':
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily,
            maxTokens: 8192,
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
          const { maxTokens, maxRequestTokens, maxResponseTokens } = await getGpt4TokenConfig(this.ctx);
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily: modelFamily,
            maxTokens,
            maxRequestTokens,
            maxResponseTokens,
            baseTokensPerMessage: 3,
            baseTokensPerName: 1,
            baseTokensPerCompletion: 3,
            tokenizer: 'cl100k_base',
            isExperimental: modelMetadata.isExperimental ?? false,
          };
        }
        case 'gpt-4o': {
          const { maxTokens, maxRequestTokens, maxResponseTokens } = await getGpt4TokenConfig(this.ctx);
          return {
            modelId: modelMetadata.id,
            uiName: modelMetadata.name,
            modelFamily: modelFamily,
            maxTokens,
            maxRequestTokens,
            maxResponseTokens,
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
    modelFamily: string
  ): Promise<Model.EmbeddingModelConfig | undefined> {
    const model = await this.getFirstMatchingModelMetadata({ family: modelFamily, type: 'embeddings' });
    if (model?.id) {
      switch (modelFamily) {
        case 'text-embedding-3-small':
        case 'text-embedding-ada-002':
          return {
            modelId: model.id,
            modelFamily: modelFamily,
            maxBatchSize: 16,
            maxTokens: 8192,
            tokenizer: 'cl100k_base',
          };
      }
    }
  }
}

export { ModelConfigurationProvider, DefaultModelConfigurationProvider };
