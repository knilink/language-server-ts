// import { } from '../auth/copilotTokenManager';
import { type Fetcher, type Request, type Response } from '../networking';
// import { } from '../experiments/features';
// import { } from './tokenManager';
import { FakeFetcher, createFakeJsonResponse, createFakeResponse } from './fetcher';
// import { } from '../auth/copilotToken';
// import { } from '../experiments/fetchExperiments';

// ../../../agent/src/methods/testing/overrideExpFlags.ts
type Config = { Parameters: Record<string, string | number | boolean>; AssignmentContext: string };

abstract class ExpConfigFetcher extends FakeFetcher {
  private fullConfig: {
    Features: [];
    Flights: Record<string, unknown>;
    Configs: { Id: string; Parameters: Config['Parameters'] }[];
    ParameterGroups: unknown[];
    AssignmentContext: string;
  };

  constructor(config: Config) {
    super();
    this.fullConfig = {
      Features: [],
      Flights: {},
      Configs: [{ Id: 'vscode', Parameters: config.Parameters }],
      ParameterGroups: [],
      AssignmentContext: config.AssignmentContext,
    };
  }

  async fetch(url: string, options?: Request): Promise<Response> {
    return url.endsWith('vscode/ab') ? createFakeJsonResponse(200, this.fullConfig) : createFakeResponse(404, '');
  }
}

class ExpConfigFetcherWithDelegate extends ExpConfigFetcher {
  proxySettings: undefined;
  constructor(
    config: Config,
    readonly delegate: Fetcher
  ) {
    super(config);
  }

  async fetch(url: string, options?: Request): Promise<Response> {
    return await (url.endsWith('vscode/ab') ? super.fetch(url, options) : this.delegate.fetch(url, options));
  }

  makeAbortController() {
    return this.delegate.makeAbortController();
  }
}

export { ExpConfigFetcher, ExpConfigFetcherWithDelegate };
