import { CopilotNeighboringTabs, BlockMode } from '../types';
import type { ChatModelFamily } from '../conversation/modelMetadata.ts';
import { Context } from '../context';
import { telemetryExpProblem, TelemetryData } from '../telemetry';

class ExpConfig {
  constructor(
    public variables: Partial<{
      maxpromptcompletionTokens: number;
      idechatgpt4maxtokens: number;
      idechatgpt4maxrequesttokens: number;
      idechatexpmodelfamily: ChatModelFamily;
      idechatexpmodelid: string;
      idechatenableprojectmetadata: boolean;
      idechatmetapromptversion: string;
      idechatintentmodel: string;
      idechatintentthresholdpercent: number;
      idechatintenttokenizer: string;
      idechatenableprojectcontext: boolean;
      copilotdebouncems: number;
      copilotdebouncepredict: boolean;
      copilotcontextualfilterenable: boolean;
      copilotcontextualfilterenabletree: boolean;
      copilotcontextualfilteracceptthreshold: number;
      copilotcontextualfilterexplorationtraffic: number;
      copilotdisablelogprob: boolean;
      copilotoverrideblockmode: BlockMode;
      copilotoverridefastcancellation: boolean;
      copilotoverridednumghostcompletions: number;
      copilotdropcompletionreasons: string;
      copilotcustomengine: string;
      copilotlms: number;
      copilotlbeot: boolean;
      CopilotSuffixPercent: number;
      copilotsuffixmatchthreshold: number;
      copilotnumberofsnippets: number;
      copilotneighboringtabs: Lowercase<CopilotNeighboringTabs>;
      copilotcppheaders: boolean;
      copilotrelatedfiles: boolean;
      copilotcachereferencetokens: boolean;
      copilotpromptorderlistpreset: 'default';
      copilotpromptprioritypreset: 'office-exp';
      copilotbycallbuckets: number;
      copilottimeperiodsizeinh: number;
    }>,
    public assignmentContext: string,
    public features: string
  ) { }

  static createFallbackConfig(ctx: Context, reason: string): ExpConfig {
    telemetryExpProblem(ctx, { reason });
    return this.createEmptyConfig();
  }

  static createEmptyConfig(): ExpConfig {
    return new ExpConfig({}, '', '');
  }

  addToTelemetry(telemetryData: TelemetryData): void {
    telemetryData.properties['VSCode.ABExp.Features'] = this.features;
    telemetryData.properties['abexp.assignmentcontext'] = this.assignmentContext;
  }
}

export { ExpConfig };
