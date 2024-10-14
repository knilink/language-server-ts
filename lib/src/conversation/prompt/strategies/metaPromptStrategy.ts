import { Type, type TSchema } from '@sinclair/typebox';
import { Unknown, Skill, ToolCall, Chat } from '../../../types.ts';
import type { MetaPromptOptions, PromptOptions, IPromptStrategy } from './types.ts';
import { fromHistory } from '../fromHistory.ts';
import { StringEnum } from '../../openai/openai.ts';
import { ElidableText } from '../../../../../prompt/src/elidableText/elidableText.ts';
import { Conversation } from '../../conversation.ts';
import { TurnContext } from '../../turnContext.ts';

class MetaPromptStrategy implements IPromptStrategy {
  elidableContent(conversation: Conversation): ElidableText {
    const history = fromHistory(conversation.turns.slice(0, -1));
    return new ElidableText(history ? [[history, 0.6]] : []);
  }

  suffix(options: MetaPromptOptions): string {
    if (options.promptType !== 'meta') throw new Error('Invalid prompt options for strategy');
    if (!options.supportedSkillDescriptors) throw new Error('Supported skills must be provided for meta prompts');

    return this.buildMetaPrompt(options.supportedSkillDescriptors);
  }

  buildMetaPrompt(availableSkills: Skill.ISkillDescriptor[]): string {
    const skillPrompts = availableSkills.map((skill) => this.skillToPrompt(skill)).join('\n');
    return `
Your task is to provide a helpful answer to the user's question.
To help you create that answer, you can resolve skills that give you more context.
Each skill has a description and some example user questions to help you understand when the skill may be useful.

List of available skills:
${skillPrompts}
    `.trim();
  }

  createFunctionArgumentSchema(supportedSkills: Skill.ISkillDescriptor[]): TSchema {
    const skillIdsEnum = StringEnum(supportedSkills.map((s) => s.id));
    return Type.Object({
      skillIds: Type.Array(skillIdsEnum, {
        description: 'The skill ids to resolve ranked from most to least useful',
      }),
    });
  }

  toolConfig(promptOptions: PromptOptions): Unknown.ToolConfig {
    if (promptOptions.promptType !== 'meta') throw new Error('Invalid prompt options for strategy');
    return {
      tool_choice: { type: 'function', function: { name: 'resolveSkills' } },
      tools: [
        {
          type: 'function',
          function: {
            name: 'resolveSkills',
            description: 'Resolves the skills by id to help answer the user question.',
            parameters: this.createFunctionArgumentSchema(promptOptions.supportedSkillDescriptors),
          },
        },
      ],
      extractArguments(toolCall: ToolCall) {
        return { skillIds: toolCall.function.arguments.skillIds };
      },
    };
  }

  skillToPrompt(skillDescriptor: Skill.ISkillDescriptor): string {
    const description = skillDescriptor.description ? skillDescriptor.description() : skillDescriptor.id;

    let prompt = `Skill Id: ${skillDescriptor.id}\nSkill Description: ${description}`;

    const examples = skillDescriptor.examples ? skillDescriptor.examples() : [];

    if (examples.length > 0) {
      prompt += `\nSkill Examples:\n${examples.map((e) => `  - ${e}`).join(`\n      `)}`;
    }

    return prompt;
  }

  async promptContent(
    turnContext: TurnContext,
    safetyPrompt: string,
    promptOptions: MetaPromptOptions
  ): Promise<[Chat.ElidableChatMessage[], Unknown.SkillResolution[]]> {
    let userInput = turnContext.conversation.getLastTurn().request.message;
    let elidableContent = this.elidableContent(turnContext.conversation);
    return [
      [
        { role: 'system', content: safetyPrompt },
        { role: 'user', content: elidableContent },
        { role: 'system', content: this.suffix(promptOptions) },
        {
          role: 'user',
          content: `\nThis is the user's question:\n${userInput.trim()}\n`.trim(),
        },
      ],
      [],
    ];
  }
}

export { MetaPromptStrategy };
