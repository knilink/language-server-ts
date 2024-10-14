import { Context } from '../context.ts';

import { parseVulnerabilitiesInstructions, DebugCodeVulnerability } from './vulnerabilityDebugHandler.ts';
import { CurrentEditorSkillId } from './skills/CurrentEditorSkill.ts';
import { ProjectContextSkillId } from './skills/ProjectContextSkill.ts';
import { exampleMarkdown } from './markdownRenderingSpecification.ts';
import { PromptTemplateResponse, IPromptTemplate } from './promptTemplates.ts';
import { ProjectLabelsSkillId } from './skills/ProjectLabelsSkill.ts';
import { getSkillsDump, getConversationDump, ConversationDumper } from './dump.ts';
import { TurnContext } from './turnContext.ts';
import { CancellationToken } from '../../../agent/src/cancellation.ts';
import { SkillId } from '../types.ts';
import { ConversationProgress } from './conversationProgress.ts';

function getDebugTemplates() {
  return [
    DebugFailTemplate,
    DebugWarnTemplate,
    DebugFilterTemplate,
    DebugChristmasTreeTemplate,
    DebugDumpTemplate,
    DebugEchoTemplate,
    DebugPromptTemplate,
    DebugSkillsTemplate,
    DebugVulnerabilityTemplate,
    DebugMarkdownRenderingTemplate,
    DebugLongTemplate,
    DebugProjectContextTemplate,
  ];
}

const FilteredMessage = "Oops, your response got filtered. Vote down if you think this shouldn't have happened";

class DebugFailPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.fail';
  readonly description = 'Fail for debugging purposes';
  readonly shortDescription = 'Fail';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];

  async response(
    turnContext: TurnContext,
    userMessage: string,
    cancellationToken: CancellationToken
  ): Promise<PromptTemplateResponse> {
    throw new Error(userMessage.length > 0 ? userMessage : 'Debug Fail');
  }
}

const DebugFailTemplate = new DebugFailPromptTemplate();

class DebugNotificationPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.notify';
  readonly description = 'Notify for debugging purposes';
  readonly shortDescription = 'Notify';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel', 'inline'];
  async response(turnContext: TurnContext, userMessage: string, cancellationToken: CancellationToken) {
    let severity: ConversationProgress.Severity = 'warning';

    if (userMessage.includes('info')) {
      severity = 'info';
    }

    const message = userMessage.replace('info', '').replace('warning', '').trim();
    const notifications = [{ severity, message: message.length > 0 ? message : 'Debug Notification' }];
    return new PromptTemplateResponse("Alright, I'm producing a notification", undefined, [], notifications);
  }
}
const DebugWarnTemplate = new DebugNotificationPromptTemplate();

class DebugFilterPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.filter';
  readonly description = 'Make the RAI filter kick in';
  readonly shortDescription = 'RAI Filter';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];

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
  readonly id = 'debug.dump';
  readonly description = 'Dump the conversation';
  readonly shortDescription = 'Dump';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext) {
    return new PromptTemplateResponse(await getConversationDump(turnContext));
  }
}

const DebugDumpTemplate = new DebugDumpPromptTemplate();

class DebugChristmasTreePromptTemplate implements IPromptTemplate {
  readonly id = 'debug.tree';
  readonly description = 'Jingle bells, jingle bells, jingle all the way';
  readonly shortDescription = 'Christmas Tree';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
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
  readonly id = 'debug.skills';
  readonly description = 'Resolves and displays all available skills or a single skill (id) if provided';
  readonly shortDescription = 'Skills';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string, cancellationToken: CancellationToken) {
    let skillId;
    let strippedMessage;
    if (userMessage.length > 0) {
      const split = userMessage.split(' ');
      skillId = split[0];
      strippedMessage = split.slice(1).join(' ');
    }
    turnContext.turn.request.message = strippedMessage ?? '';

    return new PromptTemplateResponse(await getSkillsDump(turnContext, cancellationToken, skillId));
  }
}

const DebugSkillsTemplate = new DebugSkillsPromptTemplate();

class DebugVulnerabilityPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.vulnerability';
  readonly description = 'Create a message with a vulnerability annotation';
  readonly shortDescription = 'Vulnerability';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string, cancellationToken: CancellationToken) {
    let { reply, vulnerabilities } = parseVulnerabilitiesInstructions(userMessage);
    for (let i = 0; i < vulnerabilities; i++) turnContext.turn.annotations.push(DebugCodeVulnerability);
    return new PromptTemplateResponse(reply, undefined, turnContext.turn.annotations);
  }
}

const DebugVulnerabilityTemplate = new DebugVulnerabilityPromptTemplate();

class DebugMarkdownRenderingPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.markdown';
  readonly description = 'Markdown rendering specification by example';
  readonly shortDescription = 'Markdown';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string, cancellationToken: CancellationToken) {
    return new PromptTemplateResponse(exampleMarkdown);
  }
}

const DebugMarkdownRenderingTemplate = new DebugMarkdownRenderingPromptTemplate();

class DebugLongPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.long';
  readonly description = 'Generate a long response';
  readonly shortDescription = 'Long';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  instructions(ctx: Context, userMessage: string) {
    return 'Write out the OWASP top 10 with code examples in java';
  }
}
const DebugLongTemplate = new DebugLongPromptTemplate();

class DebugProjectContextPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.project';
  readonly description = 'Generate a response using the project context skill';
  readonly shortDescription = 'Project';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel', 'inline'];

  async requiredSkills(ctx: Context) {
    return [ProjectContextSkillId];
  }
}

const DebugProjectContextTemplate = new DebugProjectContextPromptTemplate();

export { getDebugTemplates };
