import { Conversation, Turn } from '../conversation/conversation.ts';
import { ConversationProgress } from '../conversation/conversationProgress.ts';
import { WorkDoneToken } from '../types.ts';

class TestConversationProgress extends ConversationProgress {
  openConversations = new Map<string, WorkDoneToken>();
  steps: ConversationProgress.IStep[] = [];

  async begin(conversation: Conversation, turn: Turn, workDoneToken: WorkDoneToken) {
    this.openConversations.set(conversation.id, workDoneToken);
    this.steps.push({
      workDoneToken,
      conversationId: conversation.id,
      turnId: turn.id,
      type: 'BEGIN',
      agentSlug: turn.agent?.agentSlug,
    });
  }

  async cancel(conversation: Conversation, turn: Turn, error: ConversationProgress.IStep['error']) {
    let workDoneToken = this.getWorkDoneToken(conversation);
    this.steps.push({ workDoneToken, conversationId: conversation.id, turnId: turn.id, type: 'CANCEL', error });
    this.openConversations.delete(conversation.id);
  }

  async end(conversation: Conversation, turn: Turn, payload: ConversationProgress.IEndPayload) {
    const workDoneToken = this.getWorkDoneToken(conversation);
    this.steps.push({ workDoneToken, conversationId: conversation.id, turnId: turn.id, type: 'END', ...payload });
    this.openConversations.delete(conversation.id);
  }

  async report(conversation: Conversation, turn: Turn, payload: ConversationProgress.IReportPayload) {
    let workDoneToken = this.getWorkDoneToken(conversation);
    this.steps.push({
      workDoneToken,
      conversationId: conversation.id,
      turnId: turn.id,
      type: 'REPORT',
      ...payload,
      steps: this.copyPayloadSteps(payload),
    });
  }

  copyPayloadSteps(payload: ConversationProgress.IReportPayload) {
    return (
      payload.steps?.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        status: s.status,
        error: s.error,
      })) || []
    );
  }

  getWorkDoneToken(conversation: Conversation): WorkDoneToken {
    let workDoneToken = this.openConversations.get(conversation.id);
    if (workDoneToken === undefined) {
      throw new Error(`No work done token for conversation ${conversation.id}`);
    }
    return workDoneToken;
  }
}

export { TestConversationProgress };
