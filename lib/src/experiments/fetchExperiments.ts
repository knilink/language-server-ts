import { FilterHeaders } from "../types.ts";
import { Context } from "../context.ts";

import { telemetryException } from "../telemetry.ts";
import { Fetcher, Response } from "../networking.ts";
import { ExpConfig } from "./expConfig.ts";

const ProdExpDomain = 'https://default.exp-tas.com';

abstract class ExpConfigMaker {
  abstract fetchExperiments(ctx: Context, filterHeaders: FilterHeaders): Promise<ExpConfig>;
}

class ExpConfigFromTAS extends ExpConfigMaker {
  private expPath: string;

  constructor(expPath: string = '/vscode/ab') {
    super();
    this.expPath = expPath;
  }

  public async fetchExperiments(ctx: Context, filterHeaders: FilterHeaders): Promise<ExpConfig> {
    let fetcher = ctx.get(Fetcher);
    let resp: Response;

    try {
      resp = await fetcher.fetch(ProdExpDomain + this.expPath, {
        method: 'GET',
        headers: filterHeaders,
        timeout: 5000, // milliseconds
      });
    } catch (e) {
      return ExpConfig.createFallbackConfig(ctx, `Error fetching ExP config: ${e}`);
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

export { ExpConfigMaker, ExpConfigFromTAS };
