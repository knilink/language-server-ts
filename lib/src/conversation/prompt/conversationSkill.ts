import { SkillId, Skill } from '../../types.ts';
import { Context } from '../../context.ts';
import { Conversation } from '../conversation.ts';
import { TurnContext } from '../turnContext.ts';
import { SkillMap } from '../skills/skillMap.ts';

class ConversationSkillRegistry<T extends Record<keyof T & SkillId, any> = SkillMap> {
  private skills: Partial<{
    [K in keyof T & SkillId]: Skill.ISkill<K, T[K]>;
  }> = {};

  registerSkill<K extends keyof T & SkillId>(skill: Skill.ISkill<K, T[K]>): void {
    if (this.skills[skill.id]) throw new Error(`Skill with id '${String(skill.id)}' already registered`);
    this.skills[skill.id] = skill;
  }
  getSkill<K extends keyof T & SkillId>(id: K): Skill.ISkill<K, T[K]> | undefined;
  getSkill(id: SkillId): Skill.ISkill<SkillId, unknown> | undefined;
  getSkill<K extends keyof T & SkillId>(id: K): Skill.ISkill<K, T[K]> | undefined {
    return this.skills[id];
  }

  getDescriptors(): Skill.ISkillDescriptor[] {
    return Object.values(this.skills);
  }
}

class StepReportingSkillResolver<T> implements Skill.ISkillResolver<T> {
  constructor(
    private delegate: Skill.ISkillResolver<T>,
    private stepId: SkillId, // for view only
    private stepTitle: string
  ) {}

  async resolveSkill(turnContext: TurnContext): Promise<T | undefined> {
    await turnContext.steps.start(this.stepId, this.stepTitle);
    try {
      const resolvedSkill = await this.delegate.resolveSkill(turnContext);
      if (!resolvedSkill) {
        await turnContext.steps.finish(this.stepId);
      }
      return resolvedSkill;
    } catch (e: any) {
      await turnContext.steps.error(this.stepId, e?.message ?? `Error resolving ${this.stepTitle}`);
      throw e;
    }
  }
}

class StepReportingSkillProcessor<T> implements Skill.ISkillProcessor<T> {
  constructor(
    private delegate: Skill.ISkillProcessor<T>,
    private stepId: SkillId // for view only
  ) {}

  value() {
    return this.delegate.value();
  }

  async processSkill(skill: T, turnContext: TurnContext) {
    try {
      const processedSkill = await this.delegate.processSkill(skill, turnContext);
      await turnContext.steps.finish(this.stepId);
      return processedSkill;
    } catch (e: any) {
      await turnContext.steps.error(this.stepId, e?.message ?? `Error processing ${this.stepId}`);
      throw e;
    }
  }
}

class SingleStepReportingSkill<K extends SkillId, T> implements Skill.ISkill<K, T> {
  _description: string;
  _resolver: (turnContext: TurnContext) => Skill.ISkillResolver<T>;
  _processor: (turnContext: TurnContext) => Skill.ISkillProcessor<T>;

  constructor(
    readonly id: K,
    description: string,
    readonly stepTitle: string,
    resolver: (turnContext: TurnContext) => Skill.ISkillResolver<T>,
    processor: (turnContext: TurnContext) => Skill.ISkillProcessor<T>,
    readonly type: 'implicit' | 'explicit' = 'explicit',
    readonly _examples: string[] = [],
    readonly _isAvailable: (ctx: Context) => Promise<boolean> = async () => true
  ) {
    this._description = description;
    this._resolver = resolver;
    this._processor = processor;
  }

  description() {
    return this._description;
  }

  examples(): string[] {
    return this._examples;
  }

  isAvailable(ctx: Context): Promise<boolean> {
    return this._isAvailable(ctx);
  }

  resolver(turnContext: TurnContext): Skill.ISkillResolver<T> {
    return new StepReportingSkillResolver<T>(this._resolver(turnContext), String(this.id), this.stepTitle);
  }

  processor(turnContext: TurnContext): Skill.ISkillProcessor<T> {
    return new StepReportingSkillProcessor<T>(this._processor(turnContext), String(this.id));
  }
}

// class ConversationSkillRegistry extends _ConversationSkillRegistry<SkillMap> { }

export { SingleStepReportingSkill, ConversationSkillRegistry };
