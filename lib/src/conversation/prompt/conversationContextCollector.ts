import { type CancellationToken } from '../../../../agent/src/cancellation.ts';
import { Skill, SkillId, UiKind } from '../../types.ts';
import { Context } from '../../context.ts';

import { TurnContext } from '../turnContext.ts';
import { TelemetryWithExp } from '../../telemetry.ts';

import { CurrentEditorSkillId } from '../skills/CurrentEditorSkill.ts';
import { ProjectLabelsSkillId } from '../skills/ProjectLabelsSkill.ts';
import { Conversations } from '../conversations.ts';
import { ProjectMetadataSkillId } from '../skills/ProjectMetadataSkill.ts';
import { ConversationSkillRegistry } from './conversationSkill.ts';
import { MetaPromptFetcher } from './metaPrompt.ts';
import { getAgents } from '../agents/agents.ts';
import { ReferencesSkillId } from '../skills/ReferencesSkill.ts';
import { type ChatMLFetcher } from '../chatMLFetcher.ts';
import { IPromptTemplate } from '../promptTemplates.ts';
import { Conversation, Turn } from '../conversation.ts';

namespace ConversationContextCollector {
  export type Agent = { additionalSkills: (ctx: Context) => Promise<SkillId[]> };
}

const mandatorySkills = (): SkillId[] => [
  ProjectMetadataSkillId,
  ProjectLabelsSkillId,
  ReferencesSkillId,
  CurrentEditorSkillId,
];

class ConversationContextCollector {
  private metaPromptFetcher: MetaPromptFetcher;

  constructor(
    ctx: Context,
    readonly chatFetcher: ChatMLFetcher
  ) {
    this.metaPromptFetcher = new MetaPromptFetcher(ctx, this.chatFetcher);
  }

  async collectContext(
    turnContext: TurnContext,
    token: CancellationToken,
    baseTelemetryWithExp: TelemetryWithExp,
    uiKind: UiKind,
    template?: IPromptTemplate,
    agent?: ConversationContextCollector.Agent
  ): Promise<{ skillIds: SkillId[] }> {
    let turnSkills: SkillId[] = [];

    if (template) {
      const templateSkills = template.requiredSkills ? await template.requiredSkills(turnContext.ctx) : [];
      turnSkills.push(...templateSkills.filter((skillId) => !mandatorySkills().includes(skillId)));
    } else {
      (
        await this.metaPromptFetcher.fetchPromptContext(
          turnContext,
          await this.selectableSkillDescriptors(turnContext.ctx, turnContext.conversation, turnContext.turn),
          token,
          baseTelemetryWithExp,
          uiKind
        )
      ).skillIds
        .reverse()
        .forEach((skillId) => {
          if (!turnSkills.includes(skillId) && !mandatorySkills().includes(skillId)) {
            turnSkills.push(skillId);
          }
        });
    }

    if (agent) {
      const additionalSkills = await agent.additionalSkills(turnContext.ctx);
      turnSkills.push(...additionalSkills.filter((skillId) => !mandatorySkills().includes(skillId)));
    }

    turnSkills.push(...mandatorySkills());
    turnSkills = turnSkills.filter((skillId) => !this.isIgnoredSkill(skillId, turnContext.turn));

    return {
      skillIds: turnContext.ctx.get(Conversations).filterSupportedSkills(turnContext.conversation.id, turnSkills),
    };
  }

  async selectableSkillDescriptors(
    ctx: Context,
    conversation: Conversation,
    turn: Turn
  ): Promise<Skill.ISkillDescriptor[]> {
    const nonSelectableSkills = await this.getNonSelectableSkills(ctx);
    const supportedSkills = ctx.get(Conversations).getSupportedSkills(conversation.id);
    const descriptors = ctx.get(ConversationSkillRegistry).getDescriptors();
    const skills = [];
    for (let desc of descriptors) {
      if (nonSelectableSkills.includes(desc.id) || !supportedSkills.includes(desc.id)) {
        continue;
      }

      if (((await desc.isAvailable?.(ctx)) ?? true) && !this.isIgnoredSkill(desc.id, turn)) {
        skills.push(desc);
      }
    }
    return skills;
  }

  async getNonSelectableSkills(ctx: Context): Promise<string[]> {
    const agents = await getAgents(ctx);
    const agentSkills = (await Promise.all(agents.map((agent) => agent.additionalSkills(ctx)))).flat();
    return [...mandatorySkills(), ...agentSkills];
  }

  isIgnoredSkill(id: SkillId, turn: Turn) {
    return turn.ignoredSkills?.some((ignoredSkill) => ignoredSkill.skillId === id);
  }
}

export { ConversationContextCollector, mandatorySkills };
