import { Context } from '../../context.ts';
import { SkillId } from '../../types.ts';
import { TurnContext } from '../turnContext.ts';
import { RemoteAgentTurnProcessor } from './remoteAgentTurnProcessor.ts';

class RemoteAgent implements RemoteAgentTurnProcessor.IAgent {
  constructor(
    readonly id: number,
    readonly slug: string,
    readonly name: string,
    readonly description: string,
    readonly avatarUrl: string,
    // optional ./remoteAgentRegistry.ts
    readonly endpoint?: string
  ) {}
  async additionalSkills(ctx: Context): Promise<SkillId[]> {
    return [];
  }
  turnProcessor(turnContext: TurnContext) {
    return new RemoteAgentTurnProcessor(this, turnContext);
  }
}

class ExtensibilityPlatformAgent extends RemoteAgent {
  constructor() {
    super(
      0,
      'github',
      'GitHub',
      "Get answers grounded in web search, code search, and your enterprise's knowledge bases.",
      'https://avatars.githubusercontent.com/u/9919?s=200&v=4',
      'chat'
    );
  }
  turnProcessor(turnContext: TurnContext) {
    return new RemoteAgentTurnProcessor(this, turnContext);
  }
}

export { ExtensibilityPlatformAgent, RemoteAgent };
