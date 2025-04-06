import type { ChatModelFamily } from '../conversation/modelMetadata.ts';

import { ModelConfigurationProvider } from '../conversation/modelConfigurations.ts';
import type {} from '../../../prompt/src/tokenization/index.ts';

function fakeChatModelConfiguration(family: ChatModelFamily) {
  return {
    modelId: 'gpt-3.5-turbo',
    modelFamily: family,
    uiName: 'Test GPT',
    maxRequestTokens: 6144,
    maxResponseTokens: 2048,
    baseTokensPerMessage: 3,
    baseTokensPerName: 1,
    baseTokensPerCompletion: 3,
    tokenizer: 'cl100k_base',
    isExperimental: false,
  };
}

function fakeEmbeddingModelConfiguration(family: ChatModelFamily) {
  return { modelId: 'embedding-test', modelFamily: family, maxBatchSize: 1, maxTokens: 50, tokenizer: 'cl100k_base' };
}

class TestModelConfigurationProvider extends ModelConfigurationProvider {
  async getBestChatModelConfig(modelFamilies: ChatModelFamily[]) {
    let firstFamily = modelFamilies[0];
    return fakeChatModelConfiguration(firstFamily);
  }
  async getFirstMatchingEmbeddingModelConfiguration(modelFamily: ChatModelFamily) {
    return fakeEmbeddingModelConfiguration(modelFamily);
  }
}

export { TestModelConfigurationProvider };
