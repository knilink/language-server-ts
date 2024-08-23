import { Chat, Unknown } from '../../../types';
import { SkillPromptOptions, IPromptStrategy } from './types';
import { TurnContext } from '../../turnContext';

import { fromSkills } from '../fromSkills';
import { ElidableText } from '../../../../../prompt/src/elidableText/elidableText';
import { fromHistory } from '../fromHistory';

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
        { role: Chat.Role.System, content: safetyPrompt },
        { role: Chat.Role.User, content: elidableContent }, // TODO string?
        { role: Chat.Role.System, content: this.suffix() },
        { role: Chat.Role.User, content: userInput },
      ],
      skillResolutions,
    ];
  }

  abstract suffix(): string;
}

class PanelUserPromptStrategy extends AbstractUserPromptStrategy {
  suffix(): string {
    return `
Use the above information, including the additional context and conversation history (if available) to answer the user's question below.
Prioritize the context given in the user's question.
When generating code, think step-by-step - describe your plan for what to build in pseudocode, written out in great detail. Then output the code in a single code block. Minimize any other prose.
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
    `.trim();
  }
}

export { PanelUserPromptStrategy, AbstractUserPromptStrategy };
