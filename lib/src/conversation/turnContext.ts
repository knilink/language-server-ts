import { Range, DocumentUri } from 'vscode-languageserver-types';

import { type TextDocumentResultStatus } from "../fileReader.ts";
import { type CancellationToken } from "../../../agent/src/cancellation.ts";

import { Skill, SkillId } from "../types.ts";
import { Context } from "../context.ts";
import { Conversation, Turn } from "./conversation.ts";

import { conversationLogger } from "./logger.ts";
import { ConversationSkillRegistry } from "./prompt/conversationSkill.ts";
import { Conversations } from "./conversations.ts";
import { ConversationProgress } from "./conversationProgress.ts";
import { ConversationDumper } from "./dump.ts";
import { Steps } from "./steps.ts";
import { SkillMap } from "./skills/skillMap.ts";

type Collectible =
  | {
    type: 'file';
    skillId: string;
    uri: string;
    status: TextDocumentResultStatus;
    range?: Range;
  }
  | {
    type: 'label';
    skillId: string;
    label: string;
  };

class TurnContext {
  readonly collector = new Collector();
  readonly skillResolver = new SkillResolver(this);
  readonly steps: Steps;

  constructor(
    readonly ctx: Context,
    readonly conversation: Conversation,
    readonly turn: Turn,
    readonly cancelationToken: CancellationToken
  ) {
    this.steps = new Steps(ctx, conversation, turn, ctx.get<ConversationProgress>(ConversationProgress));
  }

  collectFile(skillId: SkillId, uri: DocumentUri, status: TextDocumentResultStatus, range?: Range): void {
    let collectible: Collectible = { type: 'file', skillId, uri, status };
    if (range) {
      collectible.range = range;
    }
    this.collector.collect(collectible);
  }

  collectLabel(skillId: string, label: string) {
    this.collector.collect({ type: 'label', skillId, label });
  }

  isFileIncluded(uri: DocumentUri): boolean {
    return this.collector.collectibles.some((c) => c.type === 'file' && c.status === 'included' && c.uri === uri);
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
  resolveStack: SkillId[] = [];

  constructor(readonly turnContext: TurnContext) { }

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

  collect(collectible: Collectible): void {
    this.collectibles.push(collectible);
  }

  collectiblesForSkill(skillId: string): Collectible[] {
    return this.collectibles.filter((c) => c.skillId === skillId);
  }
}

export { TurnContext, SkillResolver, ConversationAbortError };
