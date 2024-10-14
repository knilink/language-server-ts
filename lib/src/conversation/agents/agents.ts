import { Context } from '../../context.ts';

import { RemoteAgentRegistry } from '../extensibility/remoteAgentRegistry.ts';
import { ExtensibilityPlatformAgent, RemoteAgent } from '../extensibility/remoteAgent.ts';
import { Features } from '../../experiments/features.ts';
// import '../skills/ProjectContextSkill.ts';

async function getAgents(ctx: Context) {
  const agents: RemoteAgent[] = [];
  const features = ctx.get(Features);
  const telemetryDataWithExp = await features.updateExPValuesAndAssignments();

  if (features.ideChatEnableExtensibilityPlatform(telemetryDataWithExp)) {
    agents.push(new ExtensibilityPlatformAgent());
    agents.push(...(await ctx.get(RemoteAgentRegistry).agents()));
  }

  return agents;
}

export { getAgents };
