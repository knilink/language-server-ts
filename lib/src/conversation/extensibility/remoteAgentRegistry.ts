import type { Context } from '../../context.ts';

import { RemoteAgent } from './remoteAgent.ts';
import { fetchCapiUrl } from '../capiFetchUtilities.ts';
import { logger } from '../../logger.ts';

const GITHUB_PLATFORM_AGENT_ID = 'github';

abstract class RemoteAgentRegistry {
  abstract agents(): Promise<RemoteAgent[]>;
}
class CapiRemoteAgentRegistry extends RemoteAgentRegistry {
  _agents?: RemoteAgent[];
  _lastFetchTime = 0;
  constructor(readonly ctx: Context) {
    super();
  }
  async agents(): Promise<RemoteAgent[]> {
    if (this.shouldRefreshAgents()) {
      this._agents = await this.fetchAgents();
    }
    return [...(this._agents ?? [])];
  }
  shouldRefreshAgents(): boolean {
    return !this._agents || !this._lastFetchTime ? true : this.isLastFetchOlderOneHour();
  }
  isLastFetchOlderOneHour() {
    return Date.now() - this._lastFetchTime > 3600_000;
  }

  async fetchAgents(): Promise<RemoteAgent[]> {
    let response = await fetchCapiUrl(this.ctx, '/agents');
    if (response.ok) {
      this._lastFetchTime = Date.now();
      return this.parseAgents(await response.text());
    } else {
      logger.error(this.ctx, 'Failed to fetch agents from CAPI', {
        status: response.status,
        statusText: response.statusText,
      });
      return [];
    }
  }
  parseAgents(text: string): RemoteAgent[] {
    try {
      const agents = JSON.parse(text).agents;

      if (!Array.isArray(agents)) {
        logger.error(this.ctx, "Expected 'agents' to be an array");
        return [];
      } else {
        return agents
          .filter((agent) => agent.slug !== GITHUB_PLATFORM_AGENT_ID)
          .map((agent) => new RemoteAgent(agent.id, agent.slug, agent.name, agent.description, agent.avatar_url));
      }
    } catch (e) {
      if (!text.includes('access denied')) {
        logger.warn(this.ctx, 'Invalid remote agent response:', text, e);
      }

      return [];
    }
  }
}

export { CapiRemoteAgentRegistry, RemoteAgentRegistry };
