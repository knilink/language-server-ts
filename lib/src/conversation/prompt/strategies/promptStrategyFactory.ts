import type { IPromptStrategy } from './types.ts';
import type { PromptType } from '../../../types.ts';
import { Context } from '../../../context.ts';

import { ChatModelFamily } from '../../modelMetadata.ts';
import { PanelUserPromptStrategy } from './userPromptStrategy.ts';
import { pickMetaPromptStrategy } from './metaPromptStrategy.ts';
import { SuggestionsPromptStrategy } from './suggestionsPromptStrategy.ts';
import { InlineUserPromptStrategy } from './inlineUserPromptStrategy.ts';

class PromptStrategyDescriptor {
  constructor(
    public promptType: PromptType,
    public modelFamilies: ChatModelFamily[],
    public strategy: (ctx: Context) => Promise<IPromptStrategy>
  ) {}
}

const descriptors: PromptStrategyDescriptor[] = [
  new PromptStrategyDescriptor(
    'user',
    [ChatModelFamily.Gpt4o, ChatModelFamily.Gpt4turbo, ChatModelFamily.Gpt4],
    async () => new PanelUserPromptStrategy() // fromSkills.promptOptions
  ),
  new PromptStrategyDescriptor(
    'inline',
    [ChatModelFamily.Gpt4o, ChatModelFamily.Gpt4turbo, ChatModelFamily.Gpt4],
    async () => new InlineUserPromptStrategy() // fromSkills.promptOptions
  ),
  new PromptStrategyDescriptor(
    'meta',
    [ChatModelFamily.Gpt35turbo],
    async (ctx: Context) => pickMetaPromptStrategy(ctx) // {promptType, supportedSkillDescriptors} Unknown.MetaPromptOptions
  ),
  new PromptStrategyDescriptor(
    'suggestions',
    [ChatModelFamily.Gpt35turbo],
    async () => new SuggestionsPromptStrategy() // unknown unused
  ),
];

class DefaultPromptStrategyFactory {
  async createPromptStrategy(
    ctx: Context,
    promptType: PromptType,
    modelFamily: ChatModelFamily
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
