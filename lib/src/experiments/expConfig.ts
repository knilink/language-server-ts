import { BlockMode } from '../types.ts';
import { Context } from '../context.ts';
import { telemetryExpProblem, TelemetryData } from '../telemetry.ts';

class ExpConfig {
  constructor(
    public variables: Partial<{
      maxpromptcompletionTokens: number;
      // idechatgpt4maxtokens: number;
      // idechatgpt4maxrequesttokens: number;
      // idechatexpmodelfamily: ChatModelFamily;
      idechatexpmodelids: string;
      idechatenableprojectmetadata: boolean;
      // idechatmetapromptversion: string;
      // idechatintentmodel: string;
      idechatenableprojectcontext: boolean;
      // idechatintentthresholdpercent: number;
      idechatprojectcontextfilecountthreshold: number;
      // idechatintenttokenizer: string;
      // idechatenableinline: boolean;
      // idechatenableprojectcontext: boolean;
      idechatenableextensibilityplatform: boolean;
      idechatmaxrequesttokens: number;
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
      // copilotneighboringtabs: Lowercase<CopilotNeighboringTabs>;
      copilotcppheaders: boolean;
      copilotrelatedfilesvscode: boolean;
      // copilotcachereferencetokens: boolean;
      copilotpromptorderlistpreset: 'default';
      copilotpromptprioritypreset: 'office-exp';
      copilotbycallbuckets: number;
      copilottimeperiodsizeinh: number;

      copilotsnippetswindowsizeforsimilarfiles: number;
      copilotsimilarfilesnippetthreshold: number;
      maxsnippetspersimilarfile: number;
      maxtopsnippetsfromsimilarfiles: number;
      maxsimilarfilesize: number;
      maxsimilarfilescount: number;
      copilotmaxsimilarfilesize: number;
    }>,
    public assignmentContext: string,
    public features: string
  ) {}

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
