import { URI } from 'vscode-uri';

import { FilterHeaders, RepoInfo, CopilotNeighboringTabs, FilterHeaderNames, BlockMode } from "../types.ts";
import { Context } from "../context.ts";

import { ChatModelFamily } from "../conversation/modelMetadata.ts";
import { EditorSession } from "../config.ts";
import {
  DEFAULT_MAX_PROMPT_LENGTH,
  DEFAULT_MAX_COMPLETION_LENGTH,
  DEFAULT_SUFFIX_PERCENT,
  DEFAULT_SUFFIX_MATCH_THRESHOLD,
  DEFAULT_NUM_SNIPPETS,
} from "../../../prompt/src/lib.ts";
import { Clock } from "../clock.ts";
import { ExpConfig } from "./expConfig.ts";
import { TelemetryWithExp, TelemetryData } from "../telemetry.ts";
// import { } from '../ghostText/contextualFilterConstants';
import { extractRepoInfoInBackground, tryGetGitHubNWO, getDogFood, getUserKind, getFtFlag } from "../prompt/repository.ts";
import { LRUCacheMap } from "../common/cache.ts";
import { GranularityDirectory } from "./granularityDirectory.ts";
import { FilterSettings } from "./filters.ts";
import { ExpConfigMaker } from "./fetchExperiments.ts";

function isCompletionsFiltersInfo(info: object) {
  return 'uri' in info;
}

class FilterSettingsToExpConfigs {
  private cache = new LRUCacheMap<string, Task<ExpConfig>>(200);

  constructor(readonly ctx: Context) { }

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
  ) { }

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
  dynamicFilters: Partial<Record<FilterHeaderNames, () => FilterHeaders[FilterHeaderNames]>> = {};
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

  getDynamicFilterValues(): FilterHeaders {
    const values: FilterHeaders = {};
    for (const [filter, generator] of Object.entries(this.dynamicFilters)) {
      values[filter as FilterHeaderNames] = generator(); // MARK might be better iterate over FilterHeaderNames instead
    }
    return values;
  }

  registerUpcomingDynamicFilter(filter: string, generator: () => FilterValue) {
    this.upcomingDynamicFilters[filter] = generator;
  }

  async updateExPValuesAndAssignments(
    ctx: any,
    filtersInfo?: { languageId?: string; uri?: URI },
    telemetryData = TelemetryData.createAndMarkAsIssued()
  ): Promise<TelemetryWithExp> {
    if (telemetryData instanceof TelemetryWithExp) {
      throw new Error('updateExPValuesAndAssignments should not be called with TelemetryWithExp');
    }

    const repoInfo: RepoInfo | 0 | undefined =
      filtersInfo && isCompletionsFiltersInfo(filtersInfo) && filtersInfo.uri // MARK wtf
        ? extractRepoInfoInBackground(ctx, filtersInfo.uri)
        : undefined;
    const repoNwo = tryGetGitHubNWO(repoInfo);
    const dogFood = getDogFood(repoInfo);
    const userKind = await getUserKind(ctx);
    const customModel = await getFtFlag(ctx);
    const fileType = filtersInfo?.languageId ?? '';

    const requestFilters: FilterHeaders = {
      'X-Copilot-Repository': repoNwo,
      'X-Copilot-FileType': fileType,
      'X-Copilot-UserKind': userKind,
      'X-Copilot-Dogfood': dogFood,
      'X-Copilot-CustomModel': customModel,
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
      return ExpConfig.createFallbackConfig(this.ctx, `Error fetching ExP config: ${e}`);
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

  debounceMs(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotdebouncems ?? 0;
  }

  debouncePredict(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotdebouncepredict ?? false;
  }

  contextualFilterEnable(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcontextualfilterenable ?? true;
  }

  contextualFilterEnableTree(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcontextualfilterenabletree ?? true;
  }

  contextualFilterAcceptThreshold(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcontextualfilteracceptthreshold ?? 35;
  }

  contextualFilterExplorationTraffic(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcontextualfilterexplorationtraffic ?? 1;
  }

  disableLogProb(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotdisablelogprob ?? true;
  }

  overrideBlockMode(telemetryWithExp: TelemetryWithExp): BlockMode | undefined {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotoverrideblockmode;
  }

  fastCancellation(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotoverridefastcancellation ?? true;
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

  beforeRequestWaitMs(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotlms ?? 0;
  }

  multiLogitBias(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotlbeot ?? false;
  }

  suffixPercent(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.CopilotSuffixPercent ?? DEFAULT_SUFFIX_PERCENT;
  }

  // 262
  suffixMatchThreshold(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotsuffixmatchthreshold ?? DEFAULT_SUFFIX_MATCH_THRESHOLD;
  }

  numberOfSnippets(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotnumberofsnippets ?? DEFAULT_NUM_SNIPPETS;
  }

  similarFilesOption(telemetryWithExp: TelemetryWithExp): CopilotNeighboringTabs {
    switch (telemetryWithExp.filtersAndExp.exp.variables.copilotneighboringtabs) {
      case 'none':
        return 'none';
      case 'conservative':
        return 'conservative';
      case 'medium':
        return 'medium';
      // case 'eager':
      //  return 'eager';
      case 'eagerbutlittle':
        return 'eagerButLittle';
      case 'eagerbutmedium':
        return 'eagerButMedium';
      case 'eagerbutmuch':
        return 'eagerButMuch';
      default:
        return 'eager';
    }
  }

  cppHeaders(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcppheaders ?? false;
  }

  relatedFiles(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotrelatedfiles ?? false;
  }

  cacheReferenceTokens(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.copilotcachereferencetokens ?? false;
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

  ideChatGpt4MaxTokens(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatgpt4maxtokens ?? -1;
  }

  ideChatGpt4MaxRequestTokens(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatgpt4maxrequesttokens ?? -1;
  }

  ideChatExpModelFamily(telemetryWithExp: TelemetryWithExp): ChatModelFamily | undefined {
    const variables = telemetryWithExp.filtersAndExp.exp.variables;
    switch (variables.idechatexpmodelfamily) {
      case 'gpt-4':
        return ChatModelFamily.Gpt4;
      case 'gpt-4-turbo':
        return ChatModelFamily.Gpt4turbo;
      case 'gpt-4o':
        return ChatModelFamily.Gpt4o;
      case 'gpt-3.5-turbo':
        return ChatModelFamily.Gpt35turbo;
    }
  }

  ideChatExpModelId(telemetryWithExp: TelemetryWithExp): string {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatexpmodelid ?? '';
  }

  ideChatEnableProjectMetadata(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatenableprojectmetadata ?? false;
  }

  ideChatMetaPromptVersion(telemetryWithExp: TelemetryWithExp): string {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatmetapromptversion ?? '';
  }

  ideChatIntentModel(telemetryWithExp: TelemetryWithExp): string {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatintentmodel ?? '';
  }

  ideChatIntentThresholdPercent(telemetryWithExp: TelemetryWithExp): number {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatintentthresholdpercent ?? 0;
  }

  ideChatIntentTokenizer(telemetryWithExp: TelemetryWithExp): string {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatintenttokenizer ?? '';
  }

  ideChatEnableProjectContext(telemetryWithExp: TelemetryWithExp): boolean {
    return telemetryWithExp.filtersAndExp.exp.variables.idechatenableprojectcontext ?? false;
  }
}

export { Features };
