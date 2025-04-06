import type { Context } from '../../context.ts';
import { RemoteAgentTurnProcessor } from '../extensibility/remoteAgentTurnProcessor.ts';

import { RemoteAgentRegistry } from '../extensibility/remoteAgentRegistry.ts';
import { ExtensibilityPlatformAgent } from '../extensibility/remoteAgent.ts';
import { ProjectContextSkillId } from '../skills/ProjectContextSkill.ts';
import { Features } from '../../experiments/features.ts';

async function getAgents(ctx: Context): Promise<RemoteAgentTurnProcessor.IAgent[]> {
  const agents: RemoteAgentTurnProcessor.IAgent[] = [];
  agents.push(new ExtensibilityPlatformAgent());
  agents.push(...(await ctx.get(RemoteAgentRegistry).agents()));
  const features = ctx.get(Features);
  const telemetryDataWithExp = await features.updateExPValuesAndAssignments();

  if (features.ideChatEnableProjectContext(telemetryDataWithExp)) {
    agents.push(new ProjectAgent());
  }

  return agents;
}

class ProjectAgent implements RemoteAgentTurnProcessor.IAgent {
  readonly slug = 'project';
  readonly name = 'Project';
  readonly description = 'Ask about your project';

  async additionalSkills(ctx: Context) {
    return [ProjectContextSkillId];
  }
}

export { getAgents };
