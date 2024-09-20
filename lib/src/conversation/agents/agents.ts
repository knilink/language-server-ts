import { Context } from '../../context.ts';

import { RemoteAgentRegistry } from '../extensibility/remoteAgentRegistry.ts';
import { ExtensibilityPlatformAgent, RemoteAgent } from '../extensibility/remoteAgent.ts';
import { ProjectContextSkillId } from '../skills/ProjectContextSkill.ts';
import { Features } from '../../experiments/features.ts';
import { isDebugEnabled } from '../../testing/runtimeMode.ts';

async function getAgents(ctx: Context) {
  const agents: (ProjectAgent | RemoteAgent)[] = [];
  const features = ctx.get(Features);
  const telemetryDataWithExp = await features.updateExPValuesAndAssignments();
  const projectContextEnabled = features.ideChatEnableProjectContext(telemetryDataWithExp) || isDebugEnabled(ctx);
  const extensibilityEnabled = features.ideChatEnableExtensibilityPlatform(telemetryDataWithExp);

  if (projectContextEnabled) {
    agents.push(new ProjectAgent());
  }

  if (extensibilityEnabled) {
    agents.push(new ExtensibilityPlatformAgent());
    agents.push(...(await ctx.get(RemoteAgentRegistry).agents()));
  }

  return agents;
}

class ProjectAgent {
  readonly slug = 'project';
  readonly name = 'Project';
  readonly description = 'Ask about your project';

  async additionalSkills(ctx: Context): Promise<string[]> {
    return [ProjectContextSkillId];
  }
}

const localAgents: ProjectAgent[] = [new ProjectAgent()];

export { getAgents, localAgents };
