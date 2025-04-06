import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { SkillId, Unknown } from '../types.ts';
import type { CopilotConfirmation } from '../openai/types.ts';

// import { } from './skills/ProblemInActiveDocumentSkill';
import { Context } from '../context.ts';
import { getDebugTemplates } from './promptDebugTemplates.ts';
import { isDebugEnabled, isRunningInTest } from '../testing/runtimeMode.ts';
import { getLastTurnId } from './dump.ts';
import { TurnContext } from './turnContext.ts';
import { TestFailuresSkillId } from './skills/TestFailuresSkill.ts';
import { TestContextSkillId } from './skills/TestContextSkill.ts';
import { ProblemsInActiveDocumentSkillId } from './skills/ProblemInActiveDocumentSkill.ts';
import { Reference } from './schema.ts';
import { ConversationProgress } from './conversationProgress.ts';

export type TemplateScope = 'editor' | 'chat-panel' | 'inline';

export interface IPromptTemplate {
  readonly id: string;
  readonly description: string;
  readonly shortDescription: string;
  readonly scopes: TemplateScope[];

  producesCodeEdits?: boolean;
  response?(
    turnContext: TurnContext,
    userMessage: string,
    cancellationToken: CancellationToken
  ): Promise<PromptTemplateResponse>;

  instructions?(ctx: Context, userMessage: string, source: 'panel' | 'inline'): string;
  // ./prompt/conversationContextCollector.ts
  requiredSkills?: (ctx: Context) => Promise<SkillId[]>;
}

export function getPromptTemplates(): IPromptTemplate[] {
  return [
    GenerateTestsTemplate,
    SimplifyTemplate,
    FixTemplate,
    ExplainTemplate,
    DocTemplate,
    FeedbackTemplate,
    HelpTemplate,
    ...getDebugTemplates(),
  ];
}

export function getUserFacingPromptTemplates(ctx: Context) {
  let templates = getPromptTemplates();
  if (!isDebugEnabled(ctx) && !isRunningInTest(ctx)) {
    templates = templates.filter((t) => !t.id.startsWith('debug.'));
  }
  return templates;
}

export class PromptTemplateResponse {
  constructor(
    readonly message: string,
    // ./promptDebugTemplates.ts
    readonly error?: unknown,
    readonly annotations: Unknown.Annotation[] = [],
    // ./promptDebugTemplates.ts
    readonly notifications: { message: string; severity: ConversationProgress.Severity }[] = [],
    readonly references: Reference[] = [],
    readonly confirmationRequest?: CopilotConfirmation
  ) {}
}

export class StaticPromptTemplate implements IPromptTemplate {
  constructor(
    readonly id: string,
    readonly description: string,
    readonly shortDescription: string,
    readonly prompt: string,
    readonly skills?: SkillId[],
    readonly scopes: TemplateScope[] = [],
    readonly inlinePrompt?: string,
    readonly producesCodeEdits: boolean = false
  ) {}

  instructions(ctx: Context, userMessage: string, source: 'panel' | 'inline'): string {
    const prompt = source === 'inline' && this.inlinePrompt ? this.inlinePrompt : this.prompt;
    return `${prompt}\n${userMessage}`;
  }

  async requiredSkills(ctx: Context): Promise<SkillId[]> {
    return this.skills || [];
  }
}

export class FeedbackPromptTemplate extends StaticPromptTemplate {
  constructor() {
    super('feedback', 'Steps to provide feedback', 'Feedback', '', undefined, ['chat-panel']);
  }

  async response(turnContext: TurnContext): Promise<PromptTemplateResponse> {
    const turnId = getLastTurnId(turnContext.conversation);
    let response = `
You can provide direct feedback by pressing the thumbs up/down buttons on a single message.
In case you want to share more details, please click [here](https://gh.io/copilot-chat-jb-feedback) to share your feedback.
`;
    if (turnId) {
      response += `

In order to help us understand your feedback better, you can include the following identifier in your feedback: by doing so, you are granting us permission to access the telemetry data associated with your feedback.
\`\`\`yaml
${turnContext.conversation.id}/${turnId}
\`\`\``;
    }
    return new PromptTemplateResponse(response);
  }
}

export class HelpPromptTemplate extends StaticPromptTemplate {
  constructor() {
    super('help', 'Get help on how to use Copilot chat', 'Help', '', undefined, ['chat-panel']);
  }

  async response(turnContext: TurnContext): Promise<PromptTemplateResponse> {
    const templates = getUserFacingPromptTemplates(turnContext.ctx).filter((t) => t !== this);
    const templatesString = templates.map((t) => `- \`/${t.id}\` - ${t.description}`).join(`\n`);
    const response = `
You can ask me general programming questions, or use one of the following commands to get help with a specific task:

${templatesString}

To have a great conversation, ask me questions as if I was a real programmer:

- **Show me the code** you want to talk about by having the files open and selecting the most important lines.
- On top of files, **I take different parts of your IDE into consideration** when answering questions. This includes, but is not limited to, test results and failures, build and runtime logs, active Git repository as well as details of the open project.
- **Make refinements** by asking me follow-up questions, adding clarifications, providing errors, etc.
- **Review my suggested code** and tell me about issues or improvements, so I can iterate on it.
`;
    return new PromptTemplateResponse(response);
  }
}

export const GenerateTestsTemplate = new StaticPromptTemplate(
  'tests',
  'Generate unit tests',
  'Generate Tests',
  `Write a set of unit tests for the code above, or for the selected code if provided. Provide tests for the functionality of the code and not the implementation details...`,
  [TestContextSkillId, TestFailuresSkillId],
  ['chat-panel', 'editor']
);

export const SimplifyTemplate = new StaticPromptTemplate(
  'simplify',
  'Simplify the code',
  'Simplify This',
  `Provide a simplified version of the selected code above...`,
  [],
  ['editor', 'chat-panel', 'inline'],
  `Provide a simplified version of the selected code...`,
  true
);

export const FixTemplate = new StaticPromptTemplate(
  'fix',
  'Fix problems and compile errors',
  'Fix This',
  `Fix the provided errors and problems...`,
  [ProblemsInActiveDocumentSkillId],
  ['editor', 'chat-panel', 'inline'],
  `Fix the provided errors and problems...`,
  true
);

export const ExplainTemplate = new StaticPromptTemplate(
  'explain',
  'Explain how the code works',
  'Explain This',
  `Write an explanation for the selected code above as paragraphs of text...`,
  [],
  ['editor', 'chat-panel', 'inline'],
  `Write an explanation for the code the user is selecting...`,
  false
);

export const DocTemplate = new StaticPromptTemplate(
  'doc',
  'Document the current selection of code',
  'Generate Docs',
  `Write documentation for the selected code...`,
  [],
  ['editor', 'chat-panel', 'inline'],
  `Add documentation to the selected code...`,
  true
);

export const FeedbackTemplate = new FeedbackPromptTemplate();
export const HelpTemplate = new HelpPromptTemplate();
