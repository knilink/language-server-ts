import { Range, DocumentUri } from 'vscode-languageserver-types';

import { type TextDocumentResultStatus } from '../fileReader.ts';
import { type CancellationToken } from '../../../agent/src/cancellation.ts';

import { Skill, SkillId, Snippet } from '../types.ts';
import { Context } from '../context.ts';
import { Conversation, Turn } from './conversation.ts';

import { conversationLogger } from './logger.ts';
import { ConversationSkillRegistry } from './prompt/conversationSkill.ts';
import { Conversations } from './conversations.ts';
import { ConversationProgress } from './conversationProgress.ts';
import { ConversationDumper } from './dump.ts';
import { Steps } from './steps.ts';
import { SkillMap } from './skills/skillMap.ts';

// unknown ./prompt/fromSkills.ts
type CollectorId = 'unknown' | string;

type Collectible =
  | {
      type: 'file';
      // some sort of id
      // prompt/fromSkills.ts
      collector: CollectorId;
      uri: string;
      status: TextDocumentResultStatus;
      range?: Range;
    }
  | {
      type: 'label';
      collector: CollectorId;
      label: string;
    };

class TurnContext {
  readonly collector: Collector;
  readonly skillResolver = new SkillResolver(this);
  readonly steps: Steps;

  constructor(
    readonly ctx: Context,
    readonly conversation: Conversation,
    readonly turn: Turn,
    readonly cancelationToken: CancellationToken
  ) {
    this.steps = new Steps(ctx, conversation, turn, ctx.get(ConversationProgress));
    this.collector = new Collector(conversation, turn, ctx.get(ConversationProgress));
  }

  async collectFile(
    // ./skills/RecentFilesSkill.ts
    collector: CollectorId, // SkillId
    uri: DocumentUri,
    status: TextDocumentResultStatus,
    range?: Range
  ): Promise<void> {
    const collectible: Collectible = { type: 'file', collector, uri, status };
    if (range) {
      collectible.range = range;
    }
    this.collector.collect(collectible);
  }

  collectLabel(collector: CollectorId, label: string) {
    this.collector.collect({ type: 'label', collector, label });
  }

  isFileIncluded(uri: DocumentUri): boolean {
    return this.collector.collectibles.some((c) => c.type === 'file' && c.status === 'included' && c.uri === uri);
  }
  addSkillResolutionProperties(skillId: SkillId, properties: Snippet.Resolution) {
    this.skillResolver.skillResolutionProperties[skillId] = properties;
  }
  skillResolutionProperties(skillId?: SkillId) {
    return skillId ? (this.skillResolver.skillResolutionProperties[skillId] ?? {}) : {};
  }
}

class CycleError extends Error {
  constructor(
    readonly skillId: string,
    readonly skillStack: unknown[]
  ) {
    super(`Cycle detected while resolving skills: ${skillStack.join(' -> ')} -> ${skillId}`);
  }
}

class ConversationAbortError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

class SkillResolver<T extends Record<keyof T & SkillId, any> = SkillMap> {
  readonly resolveStack: SkillId[] = [];
  readonly skillResolutionProperties: Record<SkillId, Snippet.Resolution> = {};

  constructor(readonly turnContext: TurnContext) {}

  async resolve<K extends keyof T & SkillId>(skillId: K): Promise<T[K] | undefined>;
  async resolve(skillId: SkillId): Promise<unknown | undefined>;
  async resolve<K extends keyof T & SkillId>(skillId: K): Promise<T[K] | undefined> {
    if (
      this.turnContext.ctx.get(Conversations).getSupportedSkills(this.turnContext.conversation.id).includes(skillId)
    ) {
      this.ensureNoCycle(skillId);
      const resolvedSkill = this.turnContext.ctx
        .get<ConversationDumper<T>>(ConversationDumper) // MARK might not be safe here
        .getResolvedSkill(this.turnContext.turn.id, skillId);
      if (resolvedSkill) {
        this.resolveStack.pop();
        return resolvedSkill;
      }
      let newlyResolved = await this.newlyResolve(skillId);
      this.resolveStack.pop();
      return newlyResolved;
    }
  }

  ensureNoCycle(skillId: SkillId) {
    if (this.resolveStack.includes(skillId)) throw new CycleError(skillId, this.resolveStack);
    this.resolveStack.push(skillId);
  }

  async newlyResolve<K extends keyof T & SkillId>(skillId: K): Promise<T[K] | undefined> {
    let skill = this.turnContext.ctx.get<ConversationSkillRegistry<T>>(ConversationSkillRegistry).getSkill(skillId);
    try {
      let resolvedSkill = await skill?.resolver(this.turnContext).resolveSkill(this.turnContext); // MARK might not be safe here
      if (resolvedSkill) {
        this.turnContext.ctx
          .get<ConversationDumper<T>>(ConversationDumper) // MARK might not be safe here
          .addResolvedSkill(this.turnContext.turn.id, skillId, resolvedSkill);
        return resolvedSkill;
      }
    } catch (e) {
      if (e instanceof CycleError || e instanceof ConversationAbortError) throw e;
      conversationLogger.exception(this.turnContext.ctx, e, `Error while resolving skill ${skillId}`);
    }
  }
}

class Collector {
  collectibles: Collectible[] = [];

  constructor(
    readonly conversation: Conversation,
    readonly turn: Turn,
    readonly conversationProgress: ConversationProgress
  ) {}

  async collect(collectible: Collectible): Promise<void> {
    this.collectibles.push(collectible);
    await this.reportCollectedFile(collectible);
  }
  async reportCollectedFile(collectible: Collectible): Promise<void> {
    if (collectible.type === 'file') {
      await this.conversationProgress.report(this.conversation, this.turn, {
        references: [{ type: 'file', uri: collectible.uri, status: collectible.status, range: collectible.range }],
      });
    }
  }

  collectiblesForCollector(collector: CollectorId): Collectible[] {
    return this.collectibles.filter((c) => c.collector === collector);
  }
}

export { TurnContext, SkillResolver, ConversationAbortError };
