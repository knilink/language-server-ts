import { type SkillId, Skill } from '../types.ts';
import { type Context } from '../context.ts';
import { type Reference } from './schema.ts';

import { getPromptTemplates } from './promptTemplates.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { ConversationSkillRegistry } from './prompt/conversationSkill.ts';
import { Conversation, Turn } from './conversation.ts';
import { getAgents } from './agents/agents.ts';

type ConversationId = string;

// ../../../agent/src/methods/conversation/conversationCreate.ts
type Capabilities = {
  skills: SkillId[];
  allSkills?: boolean;
};

class ConversationHolder {
  constructor(
    readonly conversation: Conversation,
    readonly capabilities: Capabilities
  ) {}
}

class Conversations {
  private conversations: LRUCacheMap<string, ConversationHolder> = new LRUCacheMap(100);

  constructor(readonly ctx: Context) {}

  async create(
    capabilities: Capabilities,
    // ../../../agent/src/methods/conversation/conversationCreate.ts
    source: 'inline' | 'panel' = 'panel'
  ): Promise<Conversation> {
    let conversation = new Conversation([], source);
    this.conversations.set(conversation.id, new ConversationHolder(conversation, capabilities));
    return conversation;
  }

  destroy(conversationId: string): void {
    this.conversations.delete(conversationId);
  }

  async addTurn(conversationId: string, turn: Turn, references?: Reference[], workspaceFolder?: string): Promise<Turn> {
    let conversation = this.getHolder(conversationId).conversation;

    turn.request.references = references ?? [];

    if (workspaceFolder) {
      turn.workspaceFolder = workspaceFolder;
    }

    await this.determineAndApplyAgent(conversation, turn);
    await this.determineAndApplyTemplate(conversation, turn);
    conversation.addTurn(turn);

    return turn;
  }

  async determineAndApplyAgent(conversation: Conversation, turn: Turn): Promise<void> {
    if (conversation.source === 'panel' && turn.request.message.trim().startsWith('@')) {
      const [agentSlug, userQuestion] = this.extractKeywordAndQuestionFromRequest(turn.request.message, '@');
      if ((await getAgents(this.ctx)).find((candidate) => candidate.slug === agentSlug)) {
        turn.request.message = userQuestion;
        turn.request.type = 'user';
        turn.agent = { agentSlug };
      }
    }
  }

  async determineAndApplyTemplate(conversation: Conversation, turn: Turn): Promise<void> {
    if (turn.request.message.trim().startsWith('/')) {
      const [templateId, userQuestion] = this.extractKeywordAndQuestionFromRequest(turn.request.message, '/');
      const template = getPromptTemplates().find((template: { id: string }) => template.id === templateId);
      if (template) {
        turn.request.message = userQuestion;
        turn.request.type = 'user';
        await this.determineAndApplyAgent(conversation, turn);
        const templateInstructions = template.instructions
          ? template.instructions(this.ctx, turn.request.message, conversation.source)
          : userQuestion;
        turn.template = { templateId: templateId, userQuestion: turn.request.message };
        turn.request.message = templateInstructions;
        turn.request.type = 'template';
      }
    }
  }

  extractKeywordAndQuestionFromRequest(request: string, keywordIndicator: string): [string, string] {
    const [keyword, ...question] = request.trim().split(' ');
    const userQuestion = question.join(' ');
    return [keyword.replace(keywordIndicator, ''), userQuestion];
  }

  deleteTurn(conversationId: ConversationId, turnId: string) {
    this.get(conversationId).deleteTurn(turnId);
  }

  get(id: string): Conversation {
    return this.getHolder(id).conversation;
  }
  getCapabilities(id: ConversationId): Capabilities {
    return this.getHolder(id).capabilities;
  }

  getSupportedSkills(id: ConversationId) {
    const implicitSkills = this.ctx
      .get(ConversationSkillRegistry)
      .getDescriptors()
      .filter((s) => s.type === 'implicit')
      .map((s) => s.id);
    const supportedSkill = this.getCapabilities(id).skills;
    return [...implicitSkills, ...supportedSkill];
  }

  filterSupportedSkills(id: ConversationId, skillIds: SkillId[]): SkillId[] {
    const supportedSkills = this.getSupportedSkills(id);
    return skillIds.filter((skillId) => supportedSkills.includes(skillId));
  }

  getHolder(id: ConversationId): ConversationHolder {
    const holder = this.conversations.get(id);
    if (!holder) throw new Error(`Conversation with id ${id} does not exist`);
    return holder;
  }

  getAll(): Conversation[] {
    return Array.from(this.conversations.values()).map((holder) => holder.conversation);
  }

  findByTurnId(turnId: string): Conversation | undefined {
    return this.getAll().find((conversation) => conversation.hasTurn(turnId));
  }
}

export { Conversations };
