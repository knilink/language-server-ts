import type { Chat, PromptType, LanguageId, Skill, Unknown, Model } from '../../../types.ts';
import type { TurnContext } from '../../turnContext.ts';

export type SkillPromptOptions =
  | {
      promptType: 'user';
      languageId?: LanguageId;
      modelConfiguration: Model.Configuration;
    }
  | {
      promptType: 'inline';
      languageId?: LanguageId;
      modelConfiguration: Model.Configuration;
    }
  | {
      promptType: 'suggestions';
      languageId?: LanguageId;
      modelConfiguration: Model.Configuration;
    }
  | {
      promptType: 'synonyms';
      languageId?: LanguageId;
      modelConfiguration: Model.Configuration;
    };

export type MetaPromptOptions = {
  promptType: 'meta';
  supportedSkillDescriptors: Skill.ISkillDescriptor[];
  modelConfiguration: Model.Configuration;
};

export type PromptOptions = SkillPromptOptions | MetaPromptOptions;

export interface IPromptStrategy {
  // elidableContent(
  //   turnContext: TurnContext,
  //   promptOptions: PromptOptions
  // ): Promise<[ElidableText, Unknown.SkillResolution[]]>;

  // elidableSkills(
  //   turnContext: TurnContext,
  //   promptOptions: PromptOptions
  // ): Promise<[string | null, Unknown.SkillResolution[]]>;

  promptContent(
    turnContext: TurnContext,
    safetyPrompt: string,
    promptOptions: PromptOptions
  ): Promise<[Chat.ElidableChatMessage[], Unknown.SkillResolution[]]>;

  // ../conversationPromptEngine.ts
  toolConfig?(options: PromptOptions): Unknown.ToolConfig;
}
