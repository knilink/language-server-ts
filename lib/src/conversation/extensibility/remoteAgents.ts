import { Context } from "../../context.ts";

import { NetworkConfiguration } from "../../networkConfiguration.ts";
import { logger } from "../../logger.ts";
import { CopilotTokenManager } from "../../auth/copilotTokenManager.ts";
import { Fetcher, Response } from "../../networking.ts";
import { RemoteAgentTurnProcessor } from "./remoteAgentTurnProcessor.ts";
import { TurnContext } from "../turnContext.ts";
import { SkillId } from "../../types.ts";

const GITHUB_PLATFORM_AGENT_ID = 'github';

abstract class RemoteAgentRegistry {
  abstract agents(): Promise<RemoteAgent[]>;
}

class CapiRemoteAgentRegistry extends RemoteAgentRegistry {
  private _agents?: RemoteAgent[];
  private _lastFetchTime = 0;

  constructor(private ctx: Context) {
    super();
  }

  async agents(): Promise<RemoteAgent[]> {
    if (this.shouldRefreshAgents()) {
      this._agents = await this.fetchAgents();
    }
    return [...(this._agents ?? [])];
  }

  shouldRefreshAgents(): boolean {
    return !this._agents || !this._lastFetchTime ? true : this.isLastFetchOlderTenMinutes();
  }

  isLastFetchOlderTenMinutes(): boolean {
    return Date.now() - this._lastFetchTime > 600_000;
  }

  async fetchAgents(): Promise<RemoteAgent[]> {
    const response = await this.fetchAgentsFromCapi();
    if (response.ok) {
      return this.parseAgents(await response.text());
    } else {
      logger.error(this.ctx, 'Failed to fetch agents from CAPI', {
        status: response.status,
        statusText: response.statusText,
      });
      return [];
    }
  }

  async fetchAgentsFromCapi(): Promise<Response> {
    const url = this.ctx.get(NetworkConfiguration).getCAPIUrl(this.ctx, 'agents');
    const headers = {
      Authorization: `Bearer ${await this.ctx.get(CopilotTokenManager).getGitHubToken(this.ctx)}`,
    };
    return await this.ctx.get(Fetcher).fetch(url, { method: 'GET', headers });
  }

  parseAgents(text: string): RemoteAgent[] {
    let agents: unknown[] = [];
    try {
      const parsed: any = JSON.parse(text);
      if (!Array.isArray(parsed?.agents)) {
        logger.error(this.ctx, "Expected 'agents' to be an array");
        return [];
      }
      agents = parsed.agents;
    } catch (e: unknown) {
      if (
        (text.includes('access denied') || logger.warn(this.ctx, `Invalid remote agent response: ${text} (${e})`),
          false)
      ) {
        return [];
      }
    }

    const filteredAgents = agents
      .filter((agent: any) => agent.slug !== GITHUB_PLATFORM_AGENT_ID)
      .map((agent: any) => new RemoteAgent(agent.id, agent.slug, agent.name, agent.description, agent.avatar_url)); // MARK
    return filteredAgents;
  }
}

class RemoteAgent {
  constructor(
    readonly id: string,
    readonly slug: string,
    readonly name: string,
    readonly description: string,
    readonly avatarUrl: string
  ) { }

  async additionalSkills(ctx: Context): Promise<SkillId[]> {
    return [];
  }

  turnProcessor(turnContext: TurnContext) {
    return new RemoteAgentTurnProcessor(this, turnContext);
  }
}

export { CapiRemoteAgentRegistry, RemoteAgentRegistry, RemoteAgent };
