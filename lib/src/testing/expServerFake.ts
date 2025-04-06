import type { Fetcher, Request, Response } from '../networking.ts';
import { FakeFetcher, createFakeJsonResponse, createFakeResponse } from './fetcher.ts';
// import { } from '../auth/copilotTokenManager';
// import { } from '../experiments/features';
// import { } from '../experiments/fetchExperiments';
// import { } from '../lib/src/networking.ts';
// import { } from './tokenManager';

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
    return url.endsWith('telemetry') ? createFakeJsonResponse(200, this.fullConfig) : createFakeResponse(404, '');
  }
}

class ExpConfigFetcherWithDelegate extends ExpConfigFetcher {
  constructor(
    config: Config,
    readonly delegate: Fetcher
  ) {
    super(config);
  }

  async fetch(url: string, options?: Request): Promise<Response> {
    return await (url.endsWith('telemetry') ? super.fetch(url, options) : this.delegate.fetch(url, options));
  }

  makeAbortController() {
    return this.delegate.makeAbortController();
  }
}

export { ExpConfigFetcher, ExpConfigFetcherWithDelegate };
