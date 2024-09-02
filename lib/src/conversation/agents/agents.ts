import { Context } from '../../context.ts';

import { ProjectContextSkillId } from '../skills/ProjectContextSkill.ts';
import { RemoteAgentRegistry, RemoteAgent } from '../extensibility/remoteAgents.ts';

async function getAgents(ctx: Context): Promise<(ProjectAgent | RemoteAgent)[]> {
  let remoteAgents = await ctx.get(RemoteAgentRegistry).agents();
  return [...agents, ...remoteAgents];
}

class ProjectAgent {
  readonly slug = 'project';
  readonly name = 'Project';
  readonly description = 'Ask about your project';

  async additionalSkills(ctx: Context): Promise<string[]> {
    return [ProjectContextSkillId];
  }
}

const agents: ProjectAgent[] = [new ProjectAgent()];

export { getAgents, agents, ProjectAgent };
