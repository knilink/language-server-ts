import type { IPromptStrategy } from './types';
import type { PromptType } from '../../../types';
import { Context } from '../../../context';

import { ChatModelFamily } from '../../modelMetadata';
import { PanelUserPromptStrategy } from './userPromptStrategy';
import { pickMetaPromptStrategy } from './metaPromptStrategy';
import { SuggestionsPromptStrategy } from './suggestionsPromptStrategy';
import { InlineUserPromptStrategy } from './inlineUserPromptStrategy';

class PromptStrategyDescriptor {
  constructor(
    public promptType: PromptType,
    public modelFamilies: ChatModelFamily[],
    public strategy: (ctx: Context) => Promise<IPromptStrategy>
  ) { }
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
