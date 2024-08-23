import { Context } from '../../context';

import { ProjectContextSkillId } from '../skills/ProjectContextSkill';
import { RemoteAgentRegistry, RemoteAgent } from '../extensibility/remoteAgents';

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
