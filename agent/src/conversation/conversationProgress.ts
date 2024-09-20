import { ProgressType } from 'vscode-languageserver/node.js';

import { Context } from '../../../lib/src/context.ts';
import { Service } from '../service.ts';
import { conversationLogger } from '../../../lib/src/conversation/logger.ts';
import { LRUCacheMap } from '../../../lib/src/common/cache.ts';
import { ConversationProgress } from '../../../lib/src/conversation/conversationProgress.ts';

import { Turn, Conversation } from '../../../lib/src/conversation/conversation.ts';

const ConversationProgressType = new ProgressType();

class AgentConversationProgress extends ConversationProgress {
  readonly workDoneTokens = new LRUCacheMap<
    string,
    { status: 'open' | 'cancelled' | 'done'; token: string; updatedAt?: number }
  >(250);

  constructor(readonly ctx: Context) {
    super();
  }

  async begin(conversation: Conversation, turn: Turn, workDoneToken: string): Promise<void> {
    this.workDoneTokens.set(conversation.id, { status: 'open', token: workDoneToken });
    await this.ctx.get(Service).connection.sendProgress(ConversationProgressType, workDoneToken, {
      kind: 'begin',
      title: `Conversation ${conversation.id} Turn ${turn.id}`,
      conversationId: conversation.id,
      turnId: turn.id,
      agentSlug: turn.agent?.agentSlug,
    });
  }

  async report(conversation: Conversation, turn: Turn, payload: Record<string, unknown>): Promise<void> {
    const workDoneToken = this.getWorkDoneToken(conversation);
    if (workDoneToken.status === 'open') {
      await this.ctx.get(Service).connection.sendProgress(ConversationProgressType, workDoneToken.token, {
        kind: 'report',
        conversationId: conversation.id,
        turnId: turn.id,
        ...payload,
      });
    }
  }

  async end(conversation: Conversation, turn: Turn, payload: Record<string, unknown>): Promise<void> {
    const workDoneToken = this.getWorkDoneToken(conversation);
    if (workDoneToken.status === 'open') {
      this.workDoneTokens.set(conversation.id, {
        status: 'done',
        token: workDoneToken.token,
        updatedAt: Date.now(),
      });
      await this.ctx.get(Service).connection.sendProgress(ConversationProgressType, workDoneToken.token, {
        kind: 'end',
        conversationId: conversation.id,
        turnId: turn.id,
        ...payload,
      });
    }
  }

  async cancel(conversation: Conversation, turn: Turn, error: unknown): Promise<void> {
    const workDoneToken = this.getWorkDoneToken(conversation);
    if (workDoneToken.status === 'open') {
      this.workDoneTokens.set(conversation.id, {
        status: 'cancelled',
        token: workDoneToken.token,
        updatedAt: Date.now(),
      });
      await this.ctx.get(Service).connection.sendProgress(ConversationProgressType, workDoneToken.token, {
        kind: 'end',
        conversationId: conversation.id,
        turnId: turn.id,
        cancellationReason: 'CancelledByUser',
        error,
      });
    }
  }

  private getWorkDoneToken(conversation: Conversation): { status: string; token: string; updatedAt?: number } {
    const workDoneTokenEntry = this.workDoneTokens.get(conversation.id);
    if (workDoneTokenEntry === undefined) {
      throw new Error(`No work done token for conversation ${conversation.id}`);
    }
    if (workDoneTokenEntry.status !== 'open') {
      conversationLogger.error(
        this.ctx,
        `Work done token for conversation ${conversation.id} is already ${workDoneTokenEntry.status}, last updated at ${workDoneTokenEntry.updatedAt}`
      );
    }
    return workDoneTokenEntry;
  }
}

export { AgentConversationProgress };
