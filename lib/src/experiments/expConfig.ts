import { BlockMode } from '../types.ts';
import { Context } from '../context.ts';
import { telemetryExpProblem, TelemetryData } from '../telemetry.ts';

class ExpConfig {
  constructor(
    public variables: Partial<{
      maxpromptcompletionTokens: number;
      copilotdisablelogprob: boolean;
      copilotoverrideblockmode: BlockMode;
      copilotoverridednumghostcompletions: number;
      copilotdropcompletionreasons: string;
      copilotcustomengine: string;
      copilotcustomenginetargetengine: unknown;
      CopilotSuffixPercent: number;
      copilotsuffixmatchthreshold: number;
      copilotcppheaders: boolean;
      copilotrelatedfilesvscodecsharp: boolean;
      copilotrelatedfilesvscodetypescript: boolean;
      copilotcppIncludeTraits: string;
      copilotcppMsvcCompilerArgumentFilter: unknown;
      copilotcppClangCompilerArgumentFilter: unknown;
      copilotcppGccCompilerArgumentFilter: unknown;
      copilotcppCompilerArgumentDirectAskMap: unknown;
      copilotrelatedfilesvscode: boolean;
      copilotexcludeopentabfilescsharp: boolean;
      copilotexcludeopentabfilescpp: boolean;
      copilotexcludeopentabfilestypescript: boolean;
      copilotfallbacktoopentabfiles: boolean;
      copilotcontextproviders: string;
      copilotincludeneighboringfiles: boolean;
      copilotpromptorderlistpreset: 'default';
      copilotpromptprioritypreset: 'office-exp';
      copilotpromptcomponents: boolean;
      idechatmaxrequesttokens: number;
      idechatexpmodelids: string;
      idechatenableprojectmetadata: boolean;
      idechatenableprojectcontext: boolean;
      ideenablecopilotedits: boolean;
      idechatprojectcontextfilecountthreshold: number;
      copilotdisabledebounce: boolean;
      copilotdebouncethreshold: number;
      copilottriggercompletionafteraccept: unknown;
      copilotasynccompletions: boolean;
      copilotspeculativerequests: boolean;
      copilotcppcodesnippetsFeatureNames: unknown;
      copilotcppcodesnippetsTimeBudgetFactor: unknown;
      copilotcppcodesnippetsMaxDistanceToCaret: unknown;
      copilotprogressivereveal: boolean;
      copilotdisablecontextualfilter: boolean;
      copilotvscodedebouncethreshold: unknown;
      ////////////////////////////////////////////////////////////////////////////////

      copilotbycallbuckets: number;
      copilottimeperiodsizeinh: number;
      // ./similarFileOptionsProvider.ts
      copilotsubsetmatching: boolean;
      // ./similarFileOptionsProviderCpp.ts
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
