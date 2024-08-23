import { Type, type Static } from '@sinclair/typebox';
import dedent from 'ts-dedent';

import { fromHistory } from '../fromHistory';
import { ElidableText } from '../../../../../prompt/src/elidableText/elidableText';
import { Turn } from '../../conversation';
import { TurnContext } from '../../turnContext';
import { Chat, ToolCall, Unknown } from '../../../types';
import { IPromptStrategy } from './types';

class SuggestionsPromptStrategy implements IPromptStrategy {
  public toolConfig(): Unknown.ToolConfig {
    return {
      tool_choice: { type: 'function', function: { name: 'showSuggestions' } },
      tools: [
        {
          type: 'function',
          function: {
            name: 'showSuggestions',
            description: 'Show the computed suggestions to the user',
            parameters: Type.Object({
              suggestedTitle: Type.String({ description: 'The suggested title for the conversation' }),
              followUp: Type.String({ description: 'The suggested follow-up question for the conversation' }),
            }),
          },
        },
      ],
      extractArguments(toolCall: ToolCall): { suggestedTitle: string; followUp: string } {
        return {
          suggestedTitle: toolCall.function.arguments.suggestedTitle,
          followUp: toolCall.function.arguments.followUp,
        };
      },
    };
  }

  private suffix(): string {
    return dedent`
            Your task is to come up with two suggestions:

            1) Suggest a title for the current conversation based on the history of the conversation so far.
                - The title must be a short phrase that captures the essence of the conversation.
                - The title must relevant to the conversation context.
                - The title must not be offensive or inappropriate.

            2) Write a short one-sentence question that the user can ask as a follow up to continue the current conversation.
                - The question must be phrased as a question asked by the user, not by Copilot.
                - The question must be relevant to the conversation context.
                - The question must not be offensive or inappropriate.
                - The question must not appear in the conversation history.
        `.trim();
  }

  async elidableContent(conversation: { turns: Turn[] }): Promise<ElidableText> {
    const history = fromHistory(conversation.turns);
    return new ElidableText(history ? [[history, 0.6]] : []);
  }

  async promptContent(
    turnContext: TurnContext,
    safetyPrompt: string,
    promptOptions: unknown
  ): Promise<[Chat.ElidableChatMessage[], Unknown.SkillResolution[]]> {
    const elidable = await this.elidableContent(turnContext.conversation);
    return [
      [
        { role: Chat.Role.System, content: safetyPrompt },
        { role: Chat.Role.User, content: elidable },
        { role: Chat.Role.System, content: this.suffix() },
      ],
      [],
    ];
  }
}

export { SuggestionsPromptStrategy };
