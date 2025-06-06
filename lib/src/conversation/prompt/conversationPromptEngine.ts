import { Unknown, Chat, Model } from '../../types.ts';
import { Context } from '../../context.ts';

import { TurnContext } from '../turnContext.ts';

import { ConversationInspector } from '../conversationInspector.ts';
import { ConversationDumper } from '../dump.ts';
import { countMessagesTokens } from '../openai/chatTokens.ts';
import { AuthManager } from '../../auth/manager.ts';
import { EditorAndPluginInfo } from '../../config.ts';
import { chatBasePrompt } from './basePrompt.ts';
import { DefaultPromptStrategyFactory } from './strategies/promptStrategyFactory.ts';
import type { PromptOptions } from './strategies/types.ts';

function processResultOfElidableText(elidedText: string): string {
  return elidedText.trimStart().replace(/^\[\.\.\.\]\n?/, '');
}

function debugChatMessages(chatMessages: Chat.ElidableChatMessage[]): string {
  return chatMessages.map((m) => m.content).join(`\n`);
}

function mapPlatformToOs(platform: NodeJS.Platform): string | undefined {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    case 'freebsd':
      return 'FreeBSD';
    case 'openbsd':
      return 'OpenBSD';
    case 'sunos':
      return 'SunOS';
    case 'aix':
      return 'AIX';
    default:
      return undefined;
  }
}

class ConversationPromptEngine {
  constructor(
    readonly ctx: Context,
    readonly promptStrategyFactory = new DefaultPromptStrategyFactory()
  ) {}

  async toPrompt(turnContext: TurnContext, options: PromptOptions): Promise<Unknown.ConversationPrompt> {
    const promptStrategy = await this.promptStrategyFactory.createPromptStrategy(
      this.ctx,
      options.promptType,
      options.modelConfiguration.modelFamily
    );
    const [elidableChatMessages, skillResolutions] = await promptStrategy.promptContent(
      turnContext,
      await this.safetyPrompt(options.userSelectedModelName ?? options.modelConfiguration.uiName),
      options
    );
    const [chatMessages, tokens] = await this.elideChatMessages(elidableChatMessages, options.modelConfiguration);

    await this.ctx.get(ConversationInspector).inspectPrompt({
      type: options.promptType,
      prompt: debugChatMessages(chatMessages),
      tokens: tokens,
    });

    this.ctx
      .get(ConversationDumper)
      .addPrompt(turnContext['turn'].id, debugChatMessages(chatMessages), options.promptType);

    return {
      messages: chatMessages,
      tokens: tokens,
      skillResolutions,
      toolConfig: promptStrategy.toolConfig?.(options),
    };
  }

  async elideChatMessages(
    elidableChatMessages: Chat.ElidableChatMessage[],
    modelConfiguration: Model.Configuration
  ): Promise<[Chat.ChatMessage[], number]> {
    const elidableMessages = elidableChatMessages.filter((m) => typeof m.content !== 'string');
    if (elidableMessages.length !== 1) throw new Error('Only one elidable message is supported right now.');

    const nonElidableTokens = this.computeNonElidableTokens(elidableChatMessages, modelConfiguration);
    const tokenBudget = modelConfiguration.maxRequestTokens - nonElidableTokens;
    const messages: Chat.ChatMessage[] = elidableChatMessages
      .map((m) => {
        const { role, content } = m;
        return {
          role,
          content: typeof content === 'string' ? content : processResultOfElidableText(content.makePrompt(tokenBudget)),
        };
      })
      .filter((m) => m.content.length > 0);
    return [messages, countMessagesTokens(messages, modelConfiguration)];
  }

  computeNonElidableTokens(
    elidableChatMessages: Chat.ElidableChatMessage[],
    modelConfiguration: Model.Configuration
  ): number {
    const nonElidableMessages: Chat.ChatMessage[] = elidableChatMessages.filter(
      (m): m is Chat.ChatMessage => typeof m.content === 'string'
    );
    return countMessagesTokens([...nonElidableMessages, { role: 'user', content: '' }], modelConfiguration);
  }

  async safetyPrompt(modelName?: string): Promise<string> {
    const authRecord = await this.ctx.get(AuthManager).getAuthRecord();
    const editorInfo = this.ctx.get(EditorAndPluginInfo).getEditorInfo();
    const osInfo = mapPlatformToOs(process.platform);
    return chatBasePrompt(this.ctx, editorInfo.readableName || editorInfo.name, authRecord?.user, osInfo, modelName);
  }
}

export { ConversationPromptEngine };
