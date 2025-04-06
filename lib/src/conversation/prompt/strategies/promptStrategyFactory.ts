import type { IPromptStrategy } from './types.ts';
import type { PromptType } from '../../../types.ts';
import { Context } from '../../../context.ts';
import type { ChatModelFamilyValues } from '../../modelMetadata.ts';

import { ChatModelFamily } from '../../modelMetadata.ts';
import { PanelUserPromptStrategy } from './userPromptStrategy.ts';
import { MetaPromptStrategy } from './metaPromptStrategy.ts';
import { SuggestionsPromptStrategy } from './suggestionsPromptStrategy.ts';
import { InlineUserPromptStrategy } from './inlineUserPromptStrategy.ts';
import { UserQuerySynonymsPromptStrategy } from './userQuerySynonymsPromptStrategy.ts';
import { getSupportedModelFamiliesForPrompt } from '../../modelMetadata.ts';

function descriptor(
  promptType: PromptType,
  modelFamilies: ChatModelFamilyValues[],
  strategy: () => Promise<IPromptStrategy>
) {
  return new PromptStrategyDescriptor(promptType, modelFamilies, strategy);
}

class PromptStrategyDescriptor {
  constructor(
    public promptType: PromptType,
    public modelFamilies: ChatModelFamilyValues[],
    public strategy: (ctx: Context) => Promise<IPromptStrategy>
  ) {}
}

const descriptors: PromptStrategyDescriptor[] = [
  descriptor('user', getSupportedModelFamiliesForPrompt('user'), async () => new PanelUserPromptStrategy()),
  descriptor('inline', getSupportedModelFamiliesForPrompt('inline'), async () => new InlineUserPromptStrategy()),
  descriptor('meta', getSupportedModelFamiliesForPrompt('meta'), async () => new MetaPromptStrategy()),
  descriptor(
    'suggestions',
    getSupportedModelFamiliesForPrompt('suggestions'),
    async () => new SuggestionsPromptStrategy()
  ),
  descriptor(
    'synonyms',
    getSupportedModelFamiliesForPrompt('synonyms'),
    async () => new UserQuerySynonymsPromptStrategy()
  ),
];

class DefaultPromptStrategyFactory {
  async createPromptStrategy(
    ctx: Context,
    promptType: PromptType,
    modelFamily: ChatModelFamilyValues
  ): Promise<IPromptStrategy> {
    const descriptor = descriptors.find((d) => d.promptType === promptType && d.modelFamilies.includes(modelFamily));
    if (!descriptor) {
      throw new Error(`No prompt strategy found for promptType: ${promptType} and modelFamily: ${modelFamily}`);
    }
    return descriptor.strategy(ctx);
  }

  get descriptors(): PromptStrategyDescriptor[] {
    return descriptors;
  }
}

export { DefaultPromptStrategyFactory, PromptStrategyDescriptor };
