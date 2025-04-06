import type { CancellationToken } from 'vscode-languageserver/node.js';
import { ConversationProgress } from './conversationProgress.ts';
import type { Context } from '../context.ts';
import type { TurnContext } from './turnContext.ts';
import type { IPromptTemplate } from './promptTemplates.ts';
import type { CopilotConfirmation } from '../openai/types.ts';
import type { SkillId } from '../types.ts';

import { default as dedent } from 'ts-dedent';
import { DebugCodeCitation, DebugCodeCitationDefaultReply } from './codeCitationsDebugHandler.ts';
import { ConversationDumper, getConversationDump, getSkillsDump } from './dump.ts';
import { exampleMarkdown } from './markdownRenderingSpecification.ts';
import { PromptTemplateResponse } from './promptTemplates.ts';
import { CurrentEditorSkillId } from './skills/CurrentEditorSkill.ts';
import { ProjectContextSkillId } from './skills/ProjectContextSkill.ts';
import { ProjectLabelsSkillId } from './skills/ProjectLabelsSkill.ts';
import { DebugCodeVulnerability, parseVulnerabilitiesInstructions } from './vulnerabilityDebugHandler.ts';

function getDebugTemplates() {
  return [
    DebugFailTemplate,
    DebugUpgradeTemplate,
    DebugWarnTemplate,
    DebugFilterTemplate,
    DebugChristmasTreeTemplate,
    DebugDumpTemplate,
    DebugEchoTemplate,
    DebugPromptTemplate,
    DebugSkillsTemplate,
    DebugVulnerabilityTemplate,
    DebugCodeCitationTemplate,
    DebugConfirmationTemplate,
    DebugMarkdownRenderingTemplate,
    DebugLongTemplate,
    DebugProjectContextTemplate,
  ];
}

const FilteredMessage = "Oops, your response got filtered. Vote down if you think this shouldn't have happened";
const UpgradeMessage =
  "You've reached your monthly chat messages limit. Upgrade to Copilot Pro (30-day free trial) or wait for your limit to reset.";

class DebugFailPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.fail';
  readonly description = 'Fail for debugging purposes';
  readonly shortDescription = 'Fail';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];

  async response(turnContext: TurnContext, userMessage: string): Promise<PromptTemplateResponse> {
    throw new Error(userMessage.length > 0 ? userMessage : 'Debug Fail');
  }
}

const DebugFailTemplate = new DebugFailPromptTemplate();

class DebugUpgradePromptTemplate {
  readonly id = 'debug.upgrade';
  readonly description = 'upgrade for debugging purposes';
  readonly shortDescription = 'upgrade';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];

  async response(_turnContext: TurnContext, userMessage: string) {
    return new PromptTemplateResponse(UpgradeMessage, {
      message: '',
      code: 402,
      responseIsIncomplete: true,
      responseIsFiltered: false,
    });
  }
}
const DebugUpgradeTemplate = new DebugUpgradePromptTemplate();

class DebugNotificationPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.notify';
  readonly description = 'Notify for debugging purposes';
  readonly shortDescription = 'Notify';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel', 'inline'];
  async response(turnContext: TurnContext, userMessage: string) {
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
  async response(turnContext: TurnContext, userMessage: string) {
    const promptsMap = turnContext.ctx.get(ConversationDumper).getLastTurnPrompts();
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
  async response(turnContext: TurnContext, userMessage: string) {
    const { reply, vulnerabilities } = parseVulnerabilitiesInstructions(userMessage);
    for (let i = 0; i < vulnerabilities; i++) turnContext.turn.annotations.push(DebugCodeVulnerability);
    return new PromptTemplateResponse(reply, undefined, turnContext.turn.annotations);
  }
}

const DebugVulnerabilityTemplate = new DebugVulnerabilityPromptTemplate();

class DebugCodeCitationPromptTemplate {
  readonly id = 'debug.citation';
  readonly description = 'Create a message with a code citation annotation';
  readonly shortDescription = 'CodeCitation';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string) {
    turnContext.turn.annotations.push(DebugCodeCitation);
    return new PromptTemplateResponse(DebugCodeCitationDefaultReply, undefined, turnContext.turn.annotations);
  }
}
const DebugCodeCitationTemplate = new DebugCodeCitationPromptTemplate();

class DebugMarkdownRenderingPromptTemplate implements IPromptTemplate {
  readonly id = 'debug.markdown';
  readonly description = 'Markdown rendering specification by example';
  readonly shortDescription = 'Markdown';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel'];
  async response(turnContext: TurnContext, userMessage: string) {
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

class DebugConfirmationPromptTemplate {
  readonly id = 'debug.confirmation';
  readonly description = 'Generate a response with a confirmation';
  readonly shortDescription = 'Confirmation';
  readonly scopes: IPromptTemplate['scopes'] = ['chat-panel', 'inline'];

  async response() {
    const confirmation: CopilotConfirmation = {
      type: 'action',
      title: 'Confirmation that you want to proceed',
      message: 'Do you want to proceed?',
      agentSlug: 'debug.confirmation',
      confirmation: { answer: 'yes' },
    };
    return new PromptTemplateResponse("Alright, I'm producing a notification", undefined, [], [], [], confirmation);
  }
}
const DebugConfirmationTemplate = new DebugConfirmationPromptTemplate();

export { getDebugTemplates };
