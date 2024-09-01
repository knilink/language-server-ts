import type { SkillId } from "../types.ts";

import type { Context } from "../context.ts";
import { conversationLogger } from "./logger.ts";
import { ConversationProgress } from "./conversationProgress.ts";
import { Turn, Conversation } from "./conversation.ts";

namespace Steps {
  export type Status = 'completed' | 'cancelled' | 'running' | 'failed';
}

type Step = {
  id: SkillId;
  title: string;
  // ./prompt/conversationSkill.ts:await turnContext.steps.start(this.stepId, this.stepTitle);
  description?: string;
  status: Steps.Status;
  error?: { message: string };
};

export class Steps {
  readonly steps: Step[];

  constructor(
    readonly ctx: Context,
    readonly conversation: Conversation,
    readonly turn: Turn,
    readonly progress: ConversationProgress
  ) {
    this.steps = [];
  }

  public async start(id: SkillId, title: string, description?: string): Promise<void> {
    let step = this.steps.find((s) => s.id === id);
    if (!step) {
      step = { id, title, description, status: 'running' };
      this.steps.push(step);
      await this.progress.report(this.conversation, this.turn, { steps: [step] });
    }
  }

  public async finish(id: SkillId): Promise<void> {
    await this.updateStep(id, (step) => {
      step.status = 'completed';
    });
  }

  public async cancel(id: SkillId): Promise<void> {
    await this.updateStep(id, (step) => {
      step.status = 'cancelled';
    });
  }

  public async finishAll(status: Steps.Status = 'completed'): Promise<void> {
    const toUpdate = this.steps
      .filter((s) => s.status === 'running')
      .map((s) => {
        s.status = status;
        return s;
      });
    if (toUpdate.length > 0) {
      await this.progress.report(this.conversation, this.turn, { steps: toUpdate });
    }
  }

  public error(id: string, message?: string): void {
    this.updateStep(id, (step) => {
      step.status = 'failed';
      step.error = { message: message || 'Unknown error' };
    });
  }

  private async updateStep(id: SkillId, stepUpdater: (step: Step) => void): Promise<void> {
    const step = this.steps.find((s) => s.id === id);
    if (step) {
      stepUpdater(step);
      await this.progress.report(this.conversation, this.turn, { steps: [step] });
    } else {
      conversationLogger.error(
        this.ctx,
        `Step ${id} not found for conversation ${this.conversation.id} and turn ${this.turn.id}`
      );
    }
  }
}
