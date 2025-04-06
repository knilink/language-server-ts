import type { RemoteAgent } from '../conversation/extensibility/remoteAgent.ts';

import { RemoteAgentRegistry } from '../conversation/extensibility/remoteAgentRegistry.ts';
import type {} from '../experiments/fetchExperiments.ts';
import type {} from '../networking.ts';
import type {} from './expServerFake.ts';

class TestRemoteAgentRegistry extends RemoteAgentRegistry {
  constructor(readonly _agents: RemoteAgent[] = []) {
    super();
  }
  async agents(): Promise<RemoteAgent[]> {
    return this._agents;
  }
}

export { TestRemoteAgentRegistry };
