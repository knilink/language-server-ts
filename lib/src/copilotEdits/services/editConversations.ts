import type { Context } from '../../context.ts';
import type { EditTurn } from '../resources/editConversation.ts';

import { EditConversationNotFoundException } from '../exceptions/editConversationNotFoundException.ts';
import { EditConversation } from '../resources/editConversation.ts';
import { LRUCacheMap } from '../../common/cache.ts';
import { Logger } from '../../logger.ts';

const logger = new Logger('CopilotEditsConversations');

class EditConversations {
  editConversations = new LRUCacheMap<string, EditConversation>(50);

  constructor(readonly ctx: Context) {}

  create(source: 'panel' = 'panel', userLanguage?: string) {
    let editConversation = new EditConversation([], source, userLanguage);
    this.editConversations.set(editConversation.id, editConversation);
    return editConversation;
  }
  destroy(conversationId: string) {
    if (this.editConversations.delete(conversationId) !== true) {
      logger.warn(this.ctx, `Edit code conversation ${conversationId} does not exist`);
    }
  }
  addTurn(conversationId: string, turn: EditTurn) {
    this.get(conversationId).addTurn(turn);
    return turn;
  }
  deleteTurn(conversationId: string, turnId: string) {
    this.get(conversationId).deleteTurn(turnId);
  }
  get(id: string) {
    return this.getEditConversation(id);
  }
  getEditConversation(id: string) {
    const editConversation = this.editConversations.get(id);
    if (!editConversation) {
      throw new EditConversationNotFoundException(`Conversation with id ${id} does not exist`);
    }
    return editConversation;
  }
  getAll() {
    return Array.from(this.editConversations.values());
  }
  findByTurnId(turnId: string) {
    let conversations = this.getAll();
    for (const conversation of conversations)
      if (conversation.hasTurn(turnId)) {
        return conversation;
      }
  }
}

export { EditConversations };
