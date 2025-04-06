import { Context } from '../context.ts';

import { telemetryException } from '../telemetry.ts';
import { Fetcher, Response } from '../networking.ts';
import { ExpConfig } from './expConfig.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { FilterHeaders } from './filters.ts';

abstract class ExpConfigMaker {
  abstract fetchExperiments(ctx: Context, filterHeaders: FilterHeaders): Promise<ExpConfig>;
}

class ExpConfigFromTAS extends ExpConfigMaker {
  constructor(
    readonly overrideTASUrl = '',
    readonly defaultFilters = {}
  ) {
    super();
  }

  public async fetchExperiments(ctx: Context, filterHeaders: FilterHeaders): Promise<ExpConfig> {
    const fetcher = ctx.get(Fetcher);
    const headers = Object.keys(filterHeaders).length === 0 ? this.defaultFilters : filterHeaders;
    const experimentationUrl =
      this.overrideTASUrl.length === 0 ? ctx.get(NetworkConfiguration).getExperimentationUrl() : this.overrideTASUrl;

    let resp: Response;

    try {
      resp = await fetcher.fetch(experimentationUrl, { method: 'GET', headers, timeout: 5_000 });
    } catch (e) {
      return ExpConfig.createFallbackConfig(ctx, `Error fetching ExP config: ${String(e)}`);
    }

    if (!resp || !resp.ok) {
      return ExpConfig.createFallbackConfig(ctx, `ExP responded with ${resp?.status}`);
    }

    let json: any;
    try {
      json = await resp.json();
    } catch (e) {
      if (e instanceof SyntaxError) {
        telemetryException(ctx, e, 'fetchExperiments');
        return ExpConfig.createFallbackConfig(ctx, 'ExP responded with invalid JSON');
      }
      throw e;
    }

    const vscodeConfig =
      json && json.hasOwnProperty('Configs')
        ? ((json as { Configs: Array<{ Id: string; Parameters: Record<string, any> }> }).Configs.find(
            (c: { Id: string }) => c.Id === 'vscode'
          ) ?? { Id: 'vscode', Parameters: {} })
        : { Id: 'vscode', Parameters: {} };
    const features = Object.entries(vscodeConfig.Parameters).map(([name, value]) => name + (value ? '' : 'cf'));

    return new ExpConfig(vscodeConfig.Parameters, json.AssignmentContext, features.join(';'));
  }
}

class ExpConfigNone extends ExpConfigMaker {
  async fetchExperiments(ctx: Context, filterHeaders: FilterHeaders) {
    return ExpConfig.createEmptyConfig();
  }
}

export { ExpConfigFromTAS, ExpConfigMaker, ExpConfigNone };
