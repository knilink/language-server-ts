import { Type } from '@sinclair/typebox';
import { v4 as uuidv4 } from 'uuid';
import { type CancellationToken } from "../cancellation.ts";

import { ConversationProgress } from "../../../lib/src/conversation/conversationProgress.ts";
import { conversationLogger } from "../../../lib/src/conversation/logger.ts";
import { Conversations } from "../../../lib/src/conversation/conversations.ts";
import { AgentSkillResolver } from "./skillResolver.ts";
import { TurnContext } from "../../../lib/src/conversation/turnContext.ts";
import { SkillId, Unknown } from "../../../lib/src/types.ts";

import { Reference } from "../../../lib/src/conversation/schema.ts";

class SyntheticTurn {
  constructor(
    readonly workDoneToken: Unknown.WorkDoneToken,
    readonly chunks: string[],
    readonly followUp = '',
    readonly suggestedTitle = '',
    readonly skills: SkillId[] = [],
    readonly references: Reference[] = []
  ) { }
}

class SyntheticTurns {
  private turns: SyntheticTurn[] = [];

  // ../methods/testing/setSyntheticTurns.ts
  add(
    workDoneToken: Unknown.WorkDoneToken,
    chunks: string[],
    followUp = '',
    suggestedTitle = '',
    skills: SkillId[] = [],
    references: Reference[] = []
  ) {
    this.turns.push(new SyntheticTurn(workDoneToken, chunks, followUp, suggestedTitle, skills, references));
  }

  get(workDoneToken: Unknown.WorkDoneToken): SyntheticTurn | undefined {
    return this.turns.find((turn) => turn.workDoneToken === workDoneToken);
  }
}

class SyntheticTurnProcessor {
  readonly conversationProgress: ConversationProgress;

  constructor(readonly turnContext: TurnContext) {
    this.conversationProgress = turnContext.ctx.get(ConversationProgress);
  }

  async process(workDoneToken: string, cancelationToken: CancellationToken): Promise<void> {
    try {
      const syntheticTurn = this.turnContext.ctx.get(SyntheticTurns).get(workDoneToken);

      // EDITED
      if (!syntheticTurn) throw new Error(`No synthetic turn found for token ${workDoneToken}`);
      await this.processWithSyntheticTurns(syntheticTurn, workDoneToken, cancelationToken);
    } catch (err: unknown) {
      conversationLogger.error(this.turnContext.ctx, `Error processing turn ${this.turnContext.turn.id}`, err);

      const errorMessage = (err as Error).message;
      this.turnContext.turn.status = 'error';
      this.turnContext.turn.response = { message: errorMessage, type: 'meta' };

      await this.conversationProgress.end(this.turnContext.conversation, this.turnContext.turn, {
        error: { message: errorMessage, responseIsIncomplete: true },
      });
    }
  }

  async processWithSyntheticTurns(
    syntheticTurn: SyntheticTurn,
    workDoneToken: string,
    cancelationToken: CancellationToken
  ): Promise<void> {
    await this.conversationProgress.begin(this.turnContext.conversation, this.turnContext.turn, workDoneToken);
    await this.resolveSyntheticSkill(syntheticTurn, cancelationToken);
    await this.processSyntheticChunks(syntheticTurn, cancelationToken);
    await this.endSyntheticProgress(syntheticTurn, cancelationToken);

    this.turnContext.turn.response = { type: 'model', message: syntheticTurn.chunks.join('') };
    this.turnContext.turn.status = cancelationToken.isCancellationRequested ? 'cancelled' : 'success';
  }

  async resolveSyntheticSkill(syntheticTurn: SyntheticTurn, cancelationToken: CancellationToken): Promise<void> {
    const capabilities = this.turnContext.ctx.get(Conversations).getCapabilities(this.turnContext.conversation.id);
    const filteredSkills = syntheticTurn.skills.filter((skill) => capabilities.skills.includes(skill)) || [];

    for (const skill of filteredSkills) {
      const resolvedSkill = await new AgentSkillResolver(
        this.turnContext.ctx,
        skill,
        Type.Object({ value: Type.String() })
      ).resolveSkill(this.turnContext);

      if (resolvedSkill && !cancelationToken.isCancellationRequested) {
        await this.conversationProgress.report(this.turnContext.conversation, this.turnContext.turn, {
          reply: resolvedSkill.value,
        });
      }
    }
  }

  async processSyntheticChunks(syntheticTurn: SyntheticTurn, cancelationToken: CancellationToken): Promise<void> {
    for (const chunk of syntheticTurn.chunks) {
      if (!cancelationToken.isCancellationRequested) {
        await this.conversationProgress.report(this.turnContext.conversation, this.turnContext.turn, {
          reply: chunk,
        });
      }
    }
  }

  async endSyntheticProgress(syntheticTurn: SyntheticTurn, cancelationToken: CancellationToken): Promise<void> {
    if (cancelationToken.isCancellationRequested) {
      await this.conversationProgress.cancel(this.turnContext.conversation, this.turnContext.turn);
    } else {
      await this.conversationProgress.end(this.turnContext.conversation, this.turnContext.turn, {
        followUp: { message: syntheticTurn.followUp || '', type: 'followup', id: uuidv4() },
        suggestedTitle: syntheticTurn.suggestedTitle,
        updatedDocuments:
          this.turnContext.conversation.source === 'inline' ? [{ uri: 'fakeUpdatedDoc.ts', text: 'fake' }] : undefined,
      });
    }
  }
}

export { SyntheticTurn, SyntheticTurns, SyntheticTurnProcessor };
