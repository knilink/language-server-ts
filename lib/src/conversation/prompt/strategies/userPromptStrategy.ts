import { Chat, Unknown } from '../../../types.ts';
import { SkillPromptOptions, IPromptStrategy } from './types.ts';
import { TurnContext } from '../../turnContext.ts';

import { fromSkills } from '../fromSkills.ts';
import { ElidableText } from '../../../../../prompt/src/elidableText/elidableText.ts';
import { fromHistory } from '../fromHistory.ts';

abstract class AbstractUserPromptStrategy implements IPromptStrategy {
  async elidableContent(
    turnContext: TurnContext,
    promptOptions: SkillPromptOptions
  ): Promise<[ElidableText, Unknown.SkillResolution[]]> {
    let elidablePromptInputs: ElidableText.Chunk[] = [];
    const history = fromHistory(turnContext.conversation.turns.slice(0, -1));

    if (history !== null) {
      elidablePromptInputs.push([history, 0.6]);
    }

    const [skills, skillResolutions] = await this.elidableSkills(turnContext, promptOptions);

    if (skills !== null) {
      if (history !== null) {
        elidablePromptInputs.push(['', 0.1]);
      }
      elidablePromptInputs.push([skills, 0.8]);
    }

    return [new ElidableText(elidablePromptInputs), skillResolutions];
  }

  async elidableSkills(
    turnContext: TurnContext,
    promptOptions: SkillPromptOptions
  ): Promise<[ElidableText | null, Unknown.SkillResolution[]]> {
    return await fromSkills(turnContext, promptOptions);
  }

  async promptContent(
    turnContext: TurnContext,
    safetyPrompt: string,
    promptOptions: SkillPromptOptions
  ): Promise<[Chat.ElidableChatMessage[], Unknown.SkillResolution[]]> {
    const userInput = turnContext.conversation.getLastTurn().request.message;
    const [elidableContent, skillResolutions] = await this.elidableContent(turnContext, promptOptions);

    return [
      [
        { role: 'system', content: safetyPrompt },
        { role: 'user', content: elidableContent },
        { role: 'system', content: this.suffix(turnContext) },
        { role: 'user', content: userInput },
      ],

      skillResolutions,
    ];
  }

  abstract suffix(turnContext: TurnContext): string;
}

class PanelUserPromptStrategy extends AbstractUserPromptStrategy {
  suffix(turnContext: TurnContext): string {
    return `
Use the above information, including the additional context and conversation history (if available) to answer the user's question below.
Prioritize the context given in the user's question.
When generating code, think step-by-step. Briefly explain the code and then output it in a single code block.
When fixing problems and errors, provide a brief description first.
When generating classes, use a separate code block for each class.
Keep your answers short and impersonal.
Use Markdown formatting in your answers.
Escape special Markdown characters (like *, ~, -, _, etc.) with a backslash or backticks when using them in your answers.
You must enclose file names and paths in single backticks. Never use single or double quotes for file names or paths.
Make sure to include the programming language name at the start of every code block.
Avoid wrapping the whole response in triple backticks.
Only use triple backticks codeblocks for code.
Do not repeat the user's code excerpt when answering.
Do not prefix your answer with "GitHub Copilot".
Do not start your answer with a programming language name.
Do not include follow up questions or suggestions for next turns.
Respond in the following locale: ${turnContext.conversation.userLanguage}.
    `.trim();
  }
}

export { PanelUserPromptStrategy, AbstractUserPromptStrategy };
