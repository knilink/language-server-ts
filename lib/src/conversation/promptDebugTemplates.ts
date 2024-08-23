import { Context } from '../context';

import { parseVulnerabilitiesInstructions, DebugCodeVulnerability } from './vulnerabilityDebugHandler';
import { CurrentEditorSkillId } from './skills/CurrentEditorSkill';
import { exampleMarkdown } from './markdownRenderingSpecification';
import { PromptTemplateResponse, IPromptTemplate } from './promptTemplates';
import { ProjectLabelsSkillId } from './skills/ProjectLabelsSkill';
import { getSkillsDump, getConversationDump, ConversationDumper } from './dump';
import { TurnContext } from './turnContext';
import { CancellationToken } from '../../../agent/src/cancellation';
import { SkillId } from '../types';

function getDebugTemplates() {
  return [
    DebugFailTemplate,
    DebugFilterTemplate,
    DebugChristmasTreeTemplate,
    DebugDumpTemplate,
    DebugEchoTemplate,
    DebugPromptTemplate,
    DebugSkillsTemplate,
    DebugVulnerabilityTemplate,
    DebugMarkdownRenderingTemplate,
  ];
}

const FilteredMessage = "Oops, your response got filtered. Vote down if you think this shouldn't have happened";

class DebugFailPromptTemplate implements IPromptTemplate {
  id = 'debug.fail';
  description = 'Fail for debugging purposes';
  shortDescription = 'Fail';
  scopes: IPromptTemplate['scopes'] = ['chat-panel'];

  async response(
    turnContext: TurnContext,
    userMessage: string,
    cancellationToken: CancellationToken
  ): Promise<PromptTemplateResponse> {
    throw new Error(userMessage.length > 0 ? userMessage : 'Debug Fail');
  }
}

const DebugFailTemplate = new DebugFailPromptTemplate();

class DebugFilterPromptTemplate implements IPromptTemplate {
  id = 'debug.filter';
  description = 'Make the RAI filter kick in';
  shortDescription = 'RAI Filter';
  scopes: IPromptTemplate['scopes'] = ['chat-panel'];

  async response(turnContext: TurnContext, userMessage: string) {
    turnContext.turn.status = 'filtered';
    return new PromptTemplateResponse(FilteredMessage, {
      message: '',
      responseIsFiltered: true,
      responseIsIncomplete: false,
    });
  }
}

const DebugFilterTemplate = new DebugFilterPromptTemplate();

class DebugDumpPromptTemplate implements IPromptTemplate {
  id = 'debug.dump';
  description = 'Dump the conversation';
  shortDescription = 'Dump';
  scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext) {
    return new PromptTemplateResponse(await getConversationDump(turnContext));
  }
}

const DebugDumpTemplate = new DebugDumpPromptTemplate();

class DebugChristmasTreePromptTemplate implements IPromptTemplate {
  id = 'debug.tree';
  description = 'Jingle bells, jingle bells, jingle all the way';
  shortDescription = 'Christmas Tree';
  scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async requiredSkills(ctx: Context): Promise<SkillId[]> {
    return [ProjectLabelsSkillId, CurrentEditorSkillId];
  }
  instructions(ctx: Context, userMessage: string) {
    return 'Create a function that prints a christmas tree';
  }
}

const DebugChristmasTreeTemplate = new DebugChristmasTreePromptTemplate();

class DebugEchoPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.echo';
  readonly description = 'Echo the user message back to the user';
  readonly shortDescription = 'Echo';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext) {
    return new PromptTemplateResponse(turnContext.turn.request.message);
  }
}

const DebugEchoTemplate = new DebugEchoPromptTemplate();

class DebugPromptPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.prompt';
  readonly description = 'Show the prompt for the last response or generate a new one';
  readonly shortDescription = 'Prompt';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string, cancellationToken: CancellationToken) {
    let promptsMap = turnContext.ctx.get(ConversationDumper).getLastTurnPrompts();
    if (promptsMap !== undefined && promptsMap.size > 0) {
      let promptDebugString = 'Here are the prompts used in the last turn:';
      return (
        promptsMap.forEach((value, key) => {
          // MARK dedent
          promptDebugString += `

### ${key} prompt

\`\`\`\`
${value}
\`\`\`\`
`;
        }),
        new PromptTemplateResponse(promptDebugString)
      );
    }
    return new PromptTemplateResponse('No prompt available');
  }
}

const DebugPromptTemplate = new DebugPromptPromptTemplate();

class DebugSkillsPromptTemplate implements IPromptTemplate {
  id = 'debug.skills';
  description = 'Resolves and displays all available skills or a single skill (id) if provided';
  shortDescription = 'Skills';
  scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string, cancellationToken: CancellationToken) {
    let skillId = userMessage.length > 0 ? userMessage : undefined;
    return new PromptTemplateResponse(await getSkillsDump(turnContext, cancellationToken, skillId));
  }
}

const DebugSkillsTemplate = new DebugSkillsPromptTemplate();

class DebugVulnerabilityPromptTemplate implements IPromptTemplate {
  id = 'debug.vulnerability';
  description = 'Create a message with a vulnerability annotation';
  shortDescription = 'Vulnerability';
  scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string, cancellationToken: CancellationToken) {
    let { reply, vulnerabilities } = parseVulnerabilitiesInstructions(userMessage);
    for (let i = 0; i < vulnerabilities; i++) turnContext.turn.annotations.push(DebugCodeVulnerability);
    return new PromptTemplateResponse(reply, undefined, turnContext.turn.annotations);
  }
}

const DebugVulnerabilityTemplate = new DebugVulnerabilityPromptTemplate();

class DebugMarkdownRenderingPromptTemplate implements IPromptTemplate {
  id = 'debug.markdown';
  description = 'Markdown rendering specification by example';
  shortDescription = 'Markdown';
  scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string, cancellationToken: CancellationToken) {
    return new PromptTemplateResponse(exampleMarkdown);
  }
}

const DebugMarkdownRenderingTemplate = new DebugMarkdownRenderingPromptTemplate();

export { getDebugTemplates };
