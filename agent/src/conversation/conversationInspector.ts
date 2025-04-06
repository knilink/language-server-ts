import { NotificationType } from 'vscode-languageserver/node.js';
import { type Context } from '../../../lib/src/context.ts';
import { isRunningInSimulation } from '../../../lib/src/testing/runtimeMode.ts';
import { Service } from '../service.ts';
import { ConversationInspector } from '../../../lib/src/conversation/conversationInspector.ts';

class AgentConversationInspector extends ConversationInspector {
  constructor(readonly ctx: Context) {
    super();
  }

  shouldInspect(): boolean {
    return isRunningInSimulation(this.ctx);
  }

  get connection() {
    if (this.shouldInspect()) {
      return this.ctx.get(Service).connection;
    }
  }

  async inspectPrompt(promptInspection: unknown): Promise<void> {
    return this.connection?.sendNotification(new NotificationType('conversation/inspectPrompt'), promptInspection);
  }

  async inspectFetchResult(fetchResult: unknown): Promise<void> {
    return this.connection?.sendNotification(new NotificationType('conversation/inspectFetchResult'), fetchResult);
  }

  async documentDiff(documentDiff: unknown): Promise<void> {
    return this.connection?.sendNotification(new NotificationType('conversation/documentDiff'), documentDiff);
  }
}

export { AgentConversationInspector };
