import type { RepoInfo, BlockMode, LanguageId } from '../types.ts';
import type { Context } from '../context.ts';
import { DocumentUri } from 'vscode-languageserver-types';

import { ExpConfig } from './expConfig.ts';
import { ExpConfigMaker } from './fetchExperiments.ts';
import { type FilterHeaderNames, type FilterHeaders, FilterSettings } from './filters.ts';
import { GranularityDirectory } from './granularityDirectory.ts';
import { Clock } from '../clock.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { EditorSession } from '../config.ts';
import { getEngineRequestInfo } from '../openai/config.ts';
import {
  extractRepoInfoInBackground,
  getDogFood,
  getTokenKeyValue,
  getUserKind,
  tryGetGitHubNWO,
} from '../prompt/repository.ts';
import { TelemetryData, TelemetryWithExp } from '../telemetry.ts';
import {
  DEFAULT_MAX_COMPLETION_LENGTH,
  DEFAULT_MAX_PROMPT_LENGTH,
  DEFAULT_SUFFIX_MATCH_THRESHOLD,
  DEFAULT_SUFFIX_PERCENT,
} from '../../../prompt/src/prompt.ts';
import '../prompt/src/lib.ts';

function isCompletionsFiltersInfo(info: object) {
  return 'uri' in info;
}

class FilterSettingsToExpConfigs {
  private cache = new LRUCacheMap<string, Task<ExpConfig>>(200);

  constructor(readonly ctx: Context) {}

  async fetchExpConfig(settings: FilterSettings): Promise<ExpConfig> {
    let task = this.cache.get(settings.stringify());
    if (!task) {
      task = new Task<ExpConfig>(
        () => this.ctx.get(ExpConfigMaker).fetchExperiments(this.ctx, settings.toHeaders()),
        1000 * 60 * 60
      );
      this.cache.set(settings.stringify(), task);
    }
    return await task.run();
  }

  getCachedExpConfig(settings: FilterSettings): ExpConfig | undefined {
    const task = this.cache.get(settings.stringify());
    return task?.value();
  }
}

class Task<T> {
  promise?: Promise<T>;
  result?: T;

  constructor(
    readonly producer: () => Promise<T>,
    readonly expirationMs = Infinity
  ) {}

  async run(): Promise<T> {
    if (this.promise === undefined) {
      this.promise = this.producer();
      this.storeResult(this.promise).then(() => {
        if (this.expirationMs < Infinity && this.promise !== undefined) {
          setTimeout(() => (this.promise = undefined), this.expirationMs);
        }
      });
    }
    return this.promise;
  }

  async storeResult(promise: Promise<T>): Promise<void> {
    try {
      this.result = await promise;
    } finally {
      if (this.result === undefined) {
        this.promise = undefined;
      }
    }
  }

  value(): T | undefined {
    return this.result;
  }
}

type FilterValue = string;

class Features {
  static upcomingTimeBucketMinutes = 20;
  static upcomingDynamicFilterCheckDelayMs = 20;

  staticFilters: FilterHeaders = {};
  dynamicFilters: Record<FilterHeaderNames, () => FilterHeaders[FilterHeaderNames]> = {};
  dynamicFilterGroups: (() => FilterHeaders)[] = [];
  upcomingDynamicFilters: Record<string, () => FilterValue> = {};
  assignments: FilterSettingsToExpConfigs;
  granularityDirectory?: GranularityDirectory;

  constructor(private ctx: Context) {
    this.assignments = new FilterSettingsToExpConfigs(this.ctx);
  }

  // ./defaultExpFilters.ts
  registerStaticFilters(filters: Record<string, string>) {
    Object.assign(this.staticFilters, filters);
  }

  registerDynamicFilter(filter: FilterHeaderNames, generator: () => FilterHeaders[FilterHeaderNames]) {
    this.dynamicFilters[filter] = generator;
  }
  registerDynamicFilterGroup(generator: () => FilterHeaders) {
    this.dynamicFilterGroups.push(generator);
  }
  getDynamicFilterValues(): FilterHeaders {
    const values: FilterHeaders = {};
    for (let generator of this.dynamicFilterGroups) {
      Object.assign(values, generator());
    }
    for (const [filter, generator] of Object.entries(this.dynamicFilters)) {
      values[filter] = generator(); // MARK might be better iterate over FilterHeaderNames instead
    }
    return values;
  }

  registerUpcomingDynamicFilter(filter: string, generator: () => FilterValue) {
    this.upcomingDynamicFilters[filter] = generator;
  }

  async updateExPValuesAndAssignments(
    // ctx: any, // 1.40.0 removed
    filtersInfo?: { languageId?: LanguageId; uri?: DocumentUri },
    telemetryData = TelemetryData.createAndMarkAsIssued()
  ): Promise<TelemetryWithExp> {
    if (telemetryData instanceof TelemetryWithExp) {
      throw new Error('updateExPValuesAndAssignments should not be called with TelemetryWithExp');
    }

    const repoInfo: RepoInfo | 0 | undefined =
      filtersInfo && isCompletionsFiltersInfo(filtersInfo) && filtersInfo.uri // MARK wtf
        ? extractRepoInfoInBackground(this.ctx, filtersInfo.uri)
        : undefined;
    const repoNwo = tryGetGitHubNWO(repoInfo);
    const dogFood = getDogFood(repoInfo);
    const fileType = filtersInfo?.languageId ?? '';
    const model = (await getEngineRequestInfo(this.ctx)).modelId;
    const userKind = await getUserKind(this.ctx);
    const customModel = await getTokenKeyValue(this.ctx, 'ft');
    const orgs = await getTokenKeyValue(this.ctx, 'ol');
    const customModelNames = await getTokenKeyValue(this.ctx, 'cml');
    const copilotTrackingId = await getTokenKeyValue(this.ctx, 'tid');

    const requestFilters = {
      'X-Copilot-Repository': repoNwo,
      'X-Copilot-FileType': fileType,
      'X-Copilot-UserKind': userKind,
      'X-Copilot-Dogfood': dogFood,
      'X-Copilot-Engine': model,
      'X-Copilot-CustomModel': customModel,
      'X-Copilot-Orgs': orgs,
      'X-Copilot-CustomModelNames': customModelNames,
      'X-Copilot-CopilotTrackingId': copilotTrackingId,
    };

    const granularityDirectory = this.getGranularityDirectory();
    const preGranularityFilters = this.makeFilterSettings(requestFilters);
    let rememberedGranularityExtension = granularityDirectory.extendFilters(preGranularityFilters);

    const expAccordingToRememberedExtension = await this.getExpConfig(rememberedGranularityExtension.newFilterSettings);

    granularityDirectory.update(
      preGranularityFilters,
      +(expAccordingToRememberedExtension.variables.copilotbycallbuckets ?? NaN),
      +(expAccordingToRememberedExtension.variables.copilottimeperiodsizeinh ?? NaN)
    );

    const currentGranularityExtension = granularityDirectory.extendFilters(preGranularityFilters);
    const filters = currentGranularityExtension.newFilterSettings;
    const exp = await this.getExpConfig(filters);

    const backgroundQueue: Promise<void> = new Promise((resolve) =>
      setTimeout(resolve, Features.upcomingDynamicFilterCheckDelayMs)
    );

    for (const upcomingFilter of currentGranularityExtension.otherFilterSettingsToPrefetch) {
      backgroundQueue
        .then(() => new Promise((resolve) => setTimeout(resolve, Features.upcomingDynamicFilterCheckDelayMs)))
        .then(() => this.getExpConfig(upcomingFilter));
    }

    this.prepareForUpcomingFilters(filters);
    return new TelemetryWithExp(telemetryData.properties, telemetryData.measurements, telemetryData.issuedTime, {
      filters: filters,
      exp: exp,
    });
  }

  getGranularityDirectory() {
    if (!this.granularityDirectory) {
      let machineId = this.ctx.get(EditorSession).machineId;
      this.granularityDirectory = new GranularityDirectory(machineId, this.ctx.get(Clock));
    }
    return this.granularityDirectory;
  }

  makeFilterSettings(requestFilters: FilterHeaders) {
    return new FilterSettings({ ...this.staticFilters, ...this.getDynamicFilterValues(), ...requestFilters });
  }

  async getExpConfig(settings: FilterSettings) {
    try {
      return this.assignments.fetchExpConfig(settings);
    } catch (e) {
      return ExpConfig.createFallbackConfig(this.ctx, `Error fetching ExP config: ${String(e)}`);
    }
  }

  async prepareForUpcomingFilters(filters: FilterSettings) {
    if (!(new Date().getMinutes() < 60 - Features.upcomingTimeBucketMinutes)) {
      for (let [filter, generator] of Object.entries(this.upcomingDynamicFilters)) {
        await new Promise((resolve) => setTimeout(resolve, Features.upcomingDynamicFilterCheckDelayMs));
        this.getExpConfig(filters.withChange(filter, generator()));
      }
    }
  }

  stringify(): string {
    let defaultExpConfig = this.assignments.getCachedExpConfig(new FilterSettings({}));
    return JSON.stringify(defaultExpConfig?.variables ?? {});
  }

  async getFallbackExpAndFilters() {
    const filters = this.makeFilterSettings({});
    const exp = await this.getExpConfig(filters);
    return { filters: filters, exp: exp };
  }

  disableLogProb(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotdisablelogprob ?? true;
  }

  overrideBlockMode(telemetryWithExp: TelemetryWithExp): BlockMode | undefined {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotoverrideblockmode;
  }

  // ../ghostText/ghostText.ts number Math.max(0, 3 - override)
  overrideNumGhostCompletions(telemetryWithExp: TelemetryWithExp): number | undefined {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotoverridednumghostcompletions;
  }

  dropCompletionReasons(telemetryWithExp: TelemetryWithExp): string[] | undefined {
    const reasons = telemetryWithExp.filtersAndExp.exp.variables.copilotdropcompletionreasons;
    return reasons ? reasons.split(',') : undefined;
  }

  customEngine(telemetryWithExp: TelemetryWithExp): string {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcustomengine ?? '';
  }

  customEngineTargetEngine(telemetryWithExp: TelemetryWithExp): unknown {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcustomenginetargetengine;
  }

  suffixPercent(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.CopilotSuffixPercent ?? DEFAULT_SUFFIX_PERCENT;
  }

  // 262
  suffixMatchThreshold(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotsuffixmatchthreshold ?? DEFAULT_SUFFIX_MATCH_THRESHOLD;
  }

  cppHeaders(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppheaders ?? false;
  }

  relatedFilesVSCodeCSharp(telemetryWithExp: TelemetryWithExp) {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotrelatedfilesvscodecsharp ?? false;
  }

  relatedFilesVSCodeTypeScript(telemetryWithExp: TelemetryWithExp) {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotrelatedfilesvscodetypescript ?? false;
  }

  cppIncludeTraits(telemetryWithExp: TelemetryWithExp) {
    let includeTraits = telemetryWithExp.filtersAndExp.exp.variables.copilotcppIncludeTraits;
    if (includeTraits) {
      return includeTraits.split(',');
    }
  }

  cppMsvcCompilerArgumentFilter(telemetryWithExp: TelemetryWithExp) {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppMsvcCompilerArgumentFilter;
  }

  cppClangCompilerArgumentFilter(telemetryWithExp: TelemetryWithExp) {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppClangCompilerArgumentFilter;
  }

  cppGccCompilerArgumentFilter(telemetryWithExp: TelemetryWithExp) {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppGccCompilerArgumentFilter;
  }

  cppCompilerArgumentDirectAskMap(telemetryWithExp: TelemetryWithExp) {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppCompilerArgumentDirectAskMap;
  }

  relatedFilesVSCode(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotrelatedfilesvscode ?? false;
  }

  excludeOpenTabFilesCSharp(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotexcludeopentabfilescsharp ?? false;
  }
  excludeOpenTabFilesCpp(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotexcludeopentabfilescpp ?? false;
  }
  excludeOpenTabFilesTypeScript(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotexcludeopentabfilestypescript ?? false;
  }
  fallbackToOpenTabFilesWithNoRelatedFiles(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotfallbacktoopentabfiles ?? false;
  }
  contextProviders(telemetryWithExp: TelemetryWithExp): string[] {
    const providers = telemetryWithExp.filtersAndExp.exp.variables.copilotcontextproviders ?? '';
    return providers ? providers.split(',').map((provider) => provider.trim()) : [];
  }
  includeNeighboringFiles(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotincludeneighboringfiles ?? false;
  }

  maxPromptCompletionTokens(telemetryWithExp: TelemetryWithExp): number {
    return (
      telemetryWithExp.filtersAndExp.exp.variables.maxpromptcompletionTokens ??
      DEFAULT_MAX_PROMPT_LENGTH + DEFAULT_MAX_COMPLETION_LENGTH
    );
  }

  // 312
  promptOrderListPreset(telemetryWithExp: TelemetryWithExp): string {
    switch (telemetryWithExp.filtersAndExp.exp.variables.copilotpromptorderlistpreset) {
      default:
        return 'default';
    }
  }

  promptPriorityPreset(telemetryWithExp: TelemetryWithExp): 'office-exp' | 'default' {
    const variables = telemetryWithExp.filtersAndExp.exp.variables;
    switch (variables.copilotpromptprioritypreset) {
      case 'office-exp':
        return 'office-exp';
      default:
        return 'default';
    }
  }

  promptComponentsEnabled(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotpromptcomponents ?? false;
  }

  ideChatMaxRequestTokens(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatmaxrequesttokens ?? -1;
  }

  ideChatExpModelIds(telemetryWithExp: TelemetryWithExp): string {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatexpmodelids ?? '';
  }

  ideChatEnableProjectMetadata(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatenableprojectmetadata ?? false;
  }
  ideChatEnableProjectContext(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatenableprojectcontext ?? false;
  }
  ideEnableCopilotEdits(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.ideenablecopilotedits ?? false;
  }
  ideChatProjectContextFileCountThreshold(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatprojectcontextfilecountthreshold ?? 0;
  }
  disableDebounce(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotdisabledebounce ?? false;
  }
  debounceThreshold(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotdebouncethreshold ?? 75;
  }
  triggerCompletionAfterAccept(telemetryWithExp: TelemetryWithExp): unknown {
    return telemetryWithExp.filtersAndExp.exp.variables.copilottriggercompletionafteraccept;
  }
  enableAsyncCompletions(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotasynccompletions ?? false;
  }
  enableSpeculativeRequests(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotspeculativerequests ?? false;
  }
  cppCodeSnippetsFeatures(telemetryWithExp: TelemetryWithExp): unknown {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppcodesnippetsFeatureNames;
  }
  cppCodeSnippetsTimeBudgetFactor(telemetryWithExp: TelemetryWithExp): unknown {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppcodesnippetsTimeBudgetFactor;
  }
  cppCodeSnippetsMaxDistanceToCaret(telemetryWithExp: TelemetryWithExp): unknown {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppcodesnippetsMaxDistanceToCaret;
  }
  enableProgressiveReveal(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotprogressivereveal ?? false;
  }
  disableContextualFilter(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotdisablecontextualfilter ?? false;
  }
  vscodeDebounceThreshold(telemetryWithExp: TelemetryWithExp): unknown {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotvscodedebouncethreshold;
  }
}

export { Features };
