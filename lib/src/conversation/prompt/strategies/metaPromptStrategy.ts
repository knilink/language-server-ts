import { Type, type TSchema } from '@sinclair/typebox';
import { Unknown, Skill, ToolCall, Chat } from '../../../types.ts';
import type { MetaPromptOptions, PromptOptions, IPromptStrategy } from './types.ts';
import { Context } from '../../../context.ts';
import { Features } from '../../../experiments/features.ts';
import { fromHistory } from '../fromHistory.ts';
import { StringEnum } from '../../openai/openai.ts';
import { ElidableText } from '../../../../../prompt/src/elidableText/elidableText.ts';
import { Conversation } from '../../conversation.ts';
import { TurnContext } from '../../turnContext.ts';

async function pickMetaPromptStrategy(ctx: Context): Promise<MetaPromptStrategy> {
  const features = ctx.get(Features);
  const telemetryDataWithExp = await features.updateExPValuesAndAssignments(ctx);
  switch (features.ideChatMetaPromptVersion(telemetryDataWithExp)) {
    case 'intentAndHistory':
      return new MetaPromptStrategyWithIntentHistory();
    default:
      return new MetaPromptStrategy();
  }
}

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
    const examples = skillDescriptor
      .examples?.()
      .map((e) => `  - ${e}`)
      .join('\n');
    if (examples) {
      prompt += `\nSkill Examples:\n${examples}`;
    }
    return prompt;
  }

  async promptContent(
    turnContext: TurnContext,
    safetyPrompt: string,
    promptOptions: MetaPromptOptions
  ): Promise<[Chat.ElidableChatMessage[], Unknown.SkillResolution[]]> {
    const lastTurn = turnContext.conversation.getLastTurn();
    const userInput = lastTurn.request.message;
    const elidableContent = this.elidableContent(turnContext.conversation);
    return [
      [
        { role: Chat.Role.System, content: safetyPrompt },
        { role: Chat.Role.User, content: elidableContent }, // TODO to be resolved
        { role: Chat.Role.System, content: this.suffix(promptOptions) },
        {
          role: Chat.Role.User,
          content: `This is the user's question:\n${userInput.trim()}`,
        },
      ],
      [],
    ];
  }
}

class MetaPromptStrategyWithIntentHistory extends MetaPromptStrategy {
  static modelFamily() {
    return 'gpt-3.5-turbo';
  }

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
Your mission is to provide a helpful answer to the user's question.
To help you create that answer, you have to gather useful context that can help you answer the user question.
The context consists of the following parts:

---
skillIds

Select which skills are the most helpful to answer the user question.
Each skill has a description and some example user questions to help you understand when the skill may be useful.
You must return a list of 1 to 4 skill IDs, ranked from most to least relevant to the user question.

List of available skills:
${skillPrompts}

---
lastRelevantQuestion

Determine the last question in the conversation history that is most relevant to answering the user question.
All questions are provided with their index and answers.
You should return the index of the last question that is most relevant to the user question, as shown in the conversation history.
All questions before the last relevant question are considered irrelevant and will be removed from the conversation history.
If there is no relevant question in the conversation history, return 0. If all questions are relevant, return 1.

---
questionIntent

Classify the intent of the user question among the following categories:
- generalProgramming: the user questions can be answered by general programming knowledge, without the need for any specific context from the user's IDE or code.
- userCode: the user question requires context from the user's IDE to be answered.
- other: the user question does not fit in any of the above categories.
    `.trim();
  }

  createFunctionArgumentSchema(supportedSkills: Skill.ISkillDescriptor[]) {
    const skillIds = supportedSkills.map((s) => s.id);
    const skillIdsEnum = StringEnum(skillIds);
    return Type.Object({
      context: Type.Object(
        {
          lastRelevantQuestion: Type.Number(),
          questionIntent: StringEnum(['generalProgramming', 'userCode', 'other']),
          skillIds: Type.Array(skillIdsEnum),
        },
        {
          description: `
The context to provide to the model.
lastRelevantQuestion is the index of the last relevant question in the conversation history.
questionIntent is the intent classification of the user question.
skillIds is a list of skill ids to consider, ranked from most to least relevant. Return between 1 and 4 skills.
          `.trim(),
        }
      ),
    });
  }

  toolConfig(promptOptions: PromptOptions): Unknown.ToolConfig {
    if (promptOptions.promptType !== 'meta') throw new Error('Invalid prompt options for strategy');
    return {
      tool_choice: { type: 'function', function: { name: 'provideContext' } },
      tools: [
        {
          type: 'function',
          function: {
            name: 'provideContext',
            description: 'Provide additional context to answer the user question.',
            parameters: this.createFunctionArgumentSchema(promptOptions.supportedSkillDescriptors),
          },
        },
      ],
      extractArguments(toolCall: ToolCall) {
        return { skillIds: toolCall.function.arguments.context?.skillIds };
      },
    };
  }

  // // MARK the same as super.skillToPrompt()?
  // skillToPrompt(skillDescriptor: Unknown.SkillDescriptor) {
  //   const description = skillDescriptor.description ? skillDescriptor.description() : skillDescriptor.id;
  //   let prompt = `Skill Id: ${skillDescriptor.id}\nSkill Description: ${description}`;
  //   const examples = skillDescriptor
  //     .examples?.()
  //     .map((e) => `  - ${e}`)
  //     .join(`\n`);
  //   if (examples) {
  //     prompt += `\nSkill Examples:\n${examples}`;
  //   }
  //   return prompt;
  // }
  //
  // // MARK the same as super.promptContent()?
  // async promptContent(
  //   turnContext: TurnContext,
  //   safetyPrompt: string,
  //   promptOptions: MetaPromptOptions
  // ): Promise<[Chat.Message[], unknown[]]> {
  //   const lastTurn = turnContext.conversation.getLastTurn();
  //   assert(lastTurn); // MARK
  //   const userInput = lastTurn.request.message;
  //   const elidableContent = this.elidableContent(turnContext.conversation);
  //   return [
  //     [
  //       { role: Chat.Role.System, content: safetyPrompt },
  //       { role: Chat.Role.User, content: elidableContent }, // TODO to be resolved
  //       { role: Chat.Role.System, content: this.suffix(promptOptions) },
  //       {
  //         role: Chat.Role.User,
  //         content: `This is the user's question:\n${userInput.trim()}`,
  //       },
  //     ],
  //     [],
  //   ];
  // }
}

export { MetaPromptStrategy, MetaPromptStrategyWithIntentHistory, pickMetaPromptStrategy };
