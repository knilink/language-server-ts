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
import { getAgents, localAgents } from '../agents/agents.ts';
import { ReferencesSkillId } from '../skills/ReferencesSkill.ts';
import { type ChatMLFetcher } from '../chatMLFetcher.ts';
import { IPromptTemplate } from '../promptTemplates.ts';
import { Conversation } from '../conversation.ts';

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
    const turnSkills: SkillId[] = [];

    if (template) {
      const templateSkills = template.requiredSkills ? await template.requiredSkills(turnContext.ctx) : [];
      turnSkills.push(...templateSkills.filter((skillId) => !mandatorySkills().includes(skillId)));
    } else {
      (
        await this.metaPromptFetcher.fetchPromptContext(
          turnContext,
          await this.selectableSkillDescriptors(turnContext.ctx, turnContext.conversation),
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

    return {
      skillIds: turnContext.ctx.get(Conversations).filterSupportedSkills(turnContext.conversation.id, turnSkills),
    };
  }

  async selectableSkillDescriptors(ctx: Context, conversation: Conversation): Promise<Skill.ISkillDescriptor[]> {
    const nonSelectableSkills = await this.getNonSelectableSkills(ctx);
    const supportedSkills = ctx.get(Conversations).getSupportedSkills(conversation.id);
    return ctx
      .get(ConversationSkillRegistry)
      .getDescriptors()
      .filter((s) => !nonSelectableSkills.includes(s.id) && supportedSkills.includes(s.id));
  }

  async getNonSelectableSkills(ctx: Context): Promise<string[]> {
    const agents = await getAgents(ctx);
    agents.push(...localAgents);
    const agentSkills = (await Promise.all(agents.map((agent) => agent.additionalSkills(ctx)))).flat();
    return [...mandatorySkills(), ...agentSkills];
  }
}

export { ConversationContextCollector, mandatorySkills };
