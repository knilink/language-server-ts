import { BlockMode, TelemetryProperties } from './types.ts';
import { Context } from './context.ts';
import { LogLevel } from './logger.ts';

import { LanguageId } from '../../prompt/src/types.ts';
import { TelemetryData, TelemetryWithExp } from './telemetry.ts';

import { isSupportedLanguageId } from '../../prompt/src/parse.ts';
import { CopilotConfigPrefix } from './constants.ts';
import { Features } from './experiments/features.ts';
import { default as packageJson } from '../../package_json.ts';

import { EventEmitter } from 'node:events';
import { NameAndVersionType } from '../../types/src/index.ts';

enum ConfigKey {
  Enable = 'enable',
  UserSelectedCompletionModel = 'selectedCompletionModel',
  ShowEditorCompletions = 'editor.showEditorCompletions',
  EnableAutoCompletions = 'editor.enableAutoCompletions',
  DelayCompletions = 'editor.delayCompletions',
  FilterCompletions = 'editor.filterCompletions',
  FetchStrategy = 'fetchStrategy',
  DebugOverrideCppHeaders = 'advanced.debug.overrideCppHeaders',
  RelatedFilesVSCodeCSharp = 'advanced.relatedFilesVSCodeCSharp',
  RelatedFilesVSCodeTypeScript = 'advanced.relatedFilesVSCodeTypeScript',
  RelatedFilesVSCode = 'advanced.relatedFilesVSCode',
  ExcludeOpenTabFilesCSharp = 'advanced.excludeOpenTabFilesCSharp',
  ExcludeOpenTabFilesCpp = 'advanced.excludeOpenTabFilesCpp',
  ExcludeOpenTabFilesTypeScript = 'advanced.excludeOpenTabFilesTypeScript',
  FallbackToOpenTabFilesWithNoRelatedFiles = 'advanced.fallbackToOpenTabFilesWithNoRelatedFiles',
  ContextProviders = 'advanced.contextProviders',
  DebugOverrideLogLevels = 'advanced.debug.overrideLogLevels',
  DebugFilterLogCategories = 'advanced.debug.filterLogCategories',
  DebugUseElectronFetcher = 'advanced.debug.useElectronFetcher',
  DebugUseEditorFetcher = 'advanced.debug.useEditorFetcher',
  UseSubsetMatching = 'advanced.useSubsetMatching',
  EnablePromptComponents = 'advanced.enablePromptComponents',
  ContextProviderTimeBudget = 'advanced.contextProviderTimeBudget',
  DebugOverrideCapiUrl = 'internal.capiUrl',
  DebugOverrideCapiUrlLegacy = 'advanced.debug.overrideCapiUrl',
  DebugTestOverrideCapiUrl = 'internal.capiTestUrl',
  DebugTestOverrideCapiUrlLegacy = 'advanced.debug.testOverrideCapiUrl',
  DebugOverrideProxyUrl = 'internal.completionsUrl',
  DebugOverrideProxyUrlLegacy = 'advanced.debug.overrideProxyUrl',
  DebugTestOverrideProxyUrl = 'internal.completionsTestUrl',
  DebugTestOverrideProxyUrlLegacy = 'advanced.debug.testOverrideProxyUrl',
  DebugOverrideEngine = 'internal.completionModel',
  DebugOverrideEngineLegacy = 'advanced.debug.overrideEngine',
  UseAsyncCompletions = 'internal.useAsyncCompletions',
  EnableProgressiveReveal = 'internal.enableProgressiveReveal',
  EnableSpeculativeRequests = 'internal.enableSpeculativeRequests',
  AlwaysRequestMultiline = 'internal.alwaysRequestMultiline',
}

interface DefaultConfigValueType {
  [ConfigKey.DebugOverrideCppHeaders]: boolean;
  [ConfigKey.RelatedFilesVSCodeCSharp]: boolean;
  [ConfigKey.RelatedFilesVSCodeTypeScript]: boolean;
  [ConfigKey.RelatedFilesVSCode]: boolean;
  [ConfigKey.ExcludeOpenTabFilesCSharp]: boolean;
  [ConfigKey.ExcludeOpenTabFilesCpp]: boolean;
  [ConfigKey.ExcludeOpenTabFilesTypeScript]: boolean;
  [ConfigKey.FallbackToOpenTabFilesWithNoRelatedFiles]: boolean;
  [ConfigKey.ContextProviders]: unknown[];
  // ../../agent/src/config.ts
  // ../../agent/src/network/delegatingFetcher.ts
  [ConfigKey.DebugUseEditorFetcher]: 'true' | 'false' | null; // boolean | string; debugUseEditorFetcher.toString() === 'true'
  [ConfigKey.DebugUseElectronFetcher]: unknown | null;
  [ConfigKey.DebugOverrideLogLevels]: Partial<{
    '*': LogLevel;
    [key: string]: LogLevel;
  }>;
  // ../../agent/src/network/delegatingFetcher.ts
  [ConfigKey.FetchStrategy]: 'auto' | 'client' | 'native';
  // ./experiments/similarFileOptionsProvider.ts
  [ConfigKey.UseSubsetMatching]: boolean | null;
  [ConfigKey.EnablePromptComponents]: boolean;
  [ConfigKey.ContextProviderTimeBudget]: number;
  [ConfigKey.DebugOverrideCapiUrl]: string;
  [ConfigKey.DebugTestOverrideCapiUrl]: string;
  [ConfigKey.DebugOverrideProxyUrl]: string;
  [ConfigKey.DebugTestOverrideProxyUrl]: string;
  [ConfigKey.DebugOverrideEngine]: string;
  [ConfigKey.UseAsyncCompletions]: unknown;
  [ConfigKey.EnableProgressiveReveal]: unknown;
  [ConfigKey.EnableSpeculativeRequests]: unknown;
  [ConfigKey.AlwaysRequestMultiline]: unknown;
  [ConfigKey.ShowEditorCompletions]: unknown;
  [ConfigKey.DelayCompletions]: unknown;
  [ConfigKey.FilterCompletions]: unknown;
}

interface ConfigValueType extends DefaultConfigValueType {
  [ConfigKey.Enable]: { '*': true; plaintext: false; markdown: false; scminput: false };
  [ConfigKey.UserSelectedCompletionModel]: unknown;
  // undefined ../../agent/src/methods/notifyChangeConfiguration.ts
  [ConfigKey.EnableAutoCompletions]: boolean;
  [ConfigKey.DebugFilterLogCategories]: [];
  [ConfigKey.DebugOverrideCapiUrlLegacy]: string;
  [ConfigKey.DebugTestOverrideCapiUrlLegacy]: string;
  [ConfigKey.DebugOverrideProxyUrlLegacy]: string;
  [ConfigKey.DebugTestOverrideProxyUrlLegacy]: string;
  [ConfigKey.DebugOverrideEngineLegacy]: string;
}

type ConfigKeysByType<U> = {
  [K in keyof ConfigValueType]: ConfigValueType[K] extends U ? K : never;
}[keyof ConfigValueType];

function shouldDoParsingTrimming(blockMode: BlockMode) {
  return ['parsing', 'parsingandserver', 'moremultiline'].includes(blockMode);
}

function shouldDoServerTrimming(blockMode: BlockMode) {
  return ['server', 'parsingandserver'].includes(blockMode);
}

function blockModeRequiresTreeSitter(blockMode: BlockMode) {
  return ['parsing', 'parsingandserver', 'moremultiline'].includes(blockMode);
}

function toApplicableBlockMode(blockMode: BlockMode, languageId: LanguageId): BlockMode {
  return blockModeRequiresTreeSitter(blockMode) && !isSupportedLanguageId(languageId) ? 'server' : blockMode;
}

function isContributesObject(obj: any) {
  return obj?.type === 'object' && 'properties' in obj;
}

function getConfigKeyRecursively(config: any, key: string): unknown {
  let value = config;
  const prefix = [];
  for (const segment of key.split('.')) {
    const child = [...prefix, segment].join('.');
    if (value && typeof value == 'object' && child in value) {
      value = value[child];
      prefix.length = 0;
    } else {
      prefix.push(segment);
    }
  }
  if (!(value === undefined || prefix.length > 0)) return value;
}

function getConfigDefaultForKey<K extends ConfigKey>(key: K): ConfigValueType[K] {
  if (key in configDefaults) return (configDefaults as any)[key];
  throw new Error(`Missing config default value: ${CopilotConfigPrefix}.${key}`);
}

function getOptionalConfigDefaultForKey<K extends ConfigKey>(key: K): ConfigValueType[K] | undefined {
  if (key in configDefaults) return (configDefaults as any)[key];
  return undefined;
}
function getConfig<K extends ConfigKey>(ctx: Context, key: K): ConfigValueType[K] {
  return ctx.get(ConfigProvider).getConfig(key);
}
function dumpForTelemetry(ctx: Context): TelemetryProperties {
  return ctx.get(ConfigProvider).dumpForTelemetry();
}
function isProduction(ctx: Context) {
  return ctx.get(BuildInfo).isProduction();
}
function getBuildType(ctx: Context) {
  return ctx.get(BuildInfo).getBuildType();
}
function getBuild(ctx: Context) {
  return ctx.get(BuildInfo).getBuild();
}
function getVersion(ctx: Context) {
  return ctx.get(BuildInfo).getVersion();
}
function formatNameAndVersion({ name: name, version: version }: { name: string; version: string }) {
  return `${name}/${version}`;
}
function editorVersionHeaders(ctx: Context) {
  let info = ctx.get(EditorAndPluginInfo);
  return {
    'X-GitHub-Api-Version': apiVersion,
    'Editor-Version': formatNameAndVersion(info.getEditorInfo()),
    'Editor-Plugin-Version': formatNameAndVersion(info.getEditorPluginInfo()),
    'Copilot-Language-Server-Version': getVersion(ctx),
  };
}

abstract class BlockModeConfig {
  abstract forLanguage(ctx: Context, languageId: LanguageId, telemetryData: TelemetryWithExp): Promise<BlockMode>;
}

class ConfigBlockModeConfig extends BlockModeConfig {
  async forLanguage(ctx: Context, languageId: LanguageId, telemetryData: TelemetryWithExp) {
    let overrideBlockMode = ctx.get(Features).overrideBlockMode(telemetryData);
    if (overrideBlockMode) {
      return toApplicableBlockMode(overrideBlockMode, languageId);
    }
    let config = getConfig(ctx, ConfigKey.AlwaysRequestMultiline);

    if (typeof config == 'boolean' && config) {
      return toApplicableBlockMode('moremultiline', languageId);
    }
    if (languageId == 'ruby') {
      return 'parsing';
    }
    if (isSupportedLanguageId(languageId)) {
      return 'parsingandserver';
    }
    return 'server';
  }
}

abstract class ConfigProvider {
  abstract getConfig<K extends ConfigKey>(key: K): ConfigValueType[K];
  abstract getOptionalConfig<K extends ConfigKey>(key: K): ConfigValueType[K] | undefined;
  abstract dumpForTelemetry(): TelemetryProperties;
}

class DefaultsOnlyConfigProvider extends ConfigProvider {
  getConfig<K extends ConfigKey>(key: K): ConfigValueType[K] {
    return getConfigDefaultForKey(key);
  }
  getOptionalConfig<K extends ConfigKey>(key: K): ConfigValueType[K] | undefined {
    return getOptionalConfigDefaultForKey(key);
  }
  dumpForTelemetry(): TelemetryProperties {
    return {};
  }
}

class InMemoryConfigProvider extends ConfigProvider {
  // private emitters = new Map<ConfigKey, EventEmitter<{ change: [any] }>>();
  private emitters: Partial<{ [K in ConfigKey]: EventEmitter<{ change: [ConfigValueType[K] | undefined] }> }> = {};
  constructor(
    protected baseConfigProvider: DefaultsOnlyConfigProvider,
    protected overrides: Partial<ConfigValueType>
  ) {
    super();
  }
  getOptionalOverride<K extends ConfigKey>(key: K): Partial<ConfigValueType>[K] {
    return this.overrides[key];
  }
  getConfig<K extends ConfigKey>(key: K): ConfigValueType[K] {
    return this.getOptionalOverride(key) ?? this.baseConfigProvider.getConfig(key);
  }
  getOptionalConfig<K extends ConfigKey>(key: K): ConfigValueType[K] | undefined {
    return this.getOptionalOverride(key) ?? this.baseConfigProvider.getOptionalConfig(key);
  }
  setConfig<K extends ConfigKey>(key: K, value?: ConfigValueType[K]) {
    if (value !== undefined) {
      this.overrides[key] = value;
    } else {
      delete this.overrides[key];
    }
    // this.emitters.get(key)?.emit('change', value);
    // MARK should emit value ?? default instead?
    this.emitters[key]?.emit('change', value);
  }
  onConfigChange<K extends ConfigKey>(key: K, listener: (value: ConfigValueType[K]) => void) {
    // if (this.emitters.has(key)) return;
    if (this.emitters[key]) return;
    const emitter = new EventEmitter<{ change: [ConfigValueType[K]] }>();
    // this.emitters.set(key, emitter);
    this.emitters[key] = emitter;
    emitter.on('change', listener);
  }
  dumpForTelemetry(): TelemetryProperties {
    const config = this.baseConfigProvider.dumpForTelemetry();
    for (const key of [
      ConfigKey.ShowEditorCompletions,
      ConfigKey.EnableAutoCompletions,
      ConfigKey.DelayCompletions,
      ConfigKey.FilterCompletions,
    ]) {
      const value = this.overrides[ConfigKey.ShowEditorCompletions];
      if (value === undefined) continue;
      config[key] = JSON.stringify(value);
    }
    return config;
  }
}

const configDefaults: DefaultConfigValueType = {
  [ConfigKey.DebugOverrideCppHeaders]: false,
  [ConfigKey.RelatedFilesVSCodeCSharp]: false,
  [ConfigKey.RelatedFilesVSCodeTypeScript]: false,
  [ConfigKey.RelatedFilesVSCode]: false,
  [ConfigKey.ExcludeOpenTabFilesCSharp]: false,
  [ConfigKey.ExcludeOpenTabFilesCpp]: false,
  [ConfigKey.ExcludeOpenTabFilesTypeScript]: false,
  [ConfigKey.FallbackToOpenTabFilesWithNoRelatedFiles]: false,
  [ConfigKey.ContextProviders]: [],
  [ConfigKey.DebugUseEditorFetcher]: null,
  [ConfigKey.DebugUseElectronFetcher]: null,
  [ConfigKey.DebugOverrideLogLevels]: {},
  [ConfigKey.FetchStrategy]: 'auto',
  [ConfigKey.UseSubsetMatching]: null,
  [ConfigKey.EnablePromptComponents]: false,
  [ConfigKey.ContextProviderTimeBudget]: 150,
  [ConfigKey.DebugOverrideCapiUrl]: '',
  [ConfigKey.DebugTestOverrideCapiUrl]: '',
  [ConfigKey.DebugOverrideProxyUrl]: '',
  [ConfigKey.DebugTestOverrideProxyUrl]: '',
  [ConfigKey.DebugOverrideEngine]: '',
  [ConfigKey.UseAsyncCompletions]: undefined,
  [ConfigKey.EnableProgressiveReveal]: undefined,
  [ConfigKey.EnableSpeculativeRequests]: undefined,
  [ConfigKey.AlwaysRequestMultiline]: undefined,
  [ConfigKey.ShowEditorCompletions]: undefined,
  [ConfigKey.DelayCompletions]: undefined,
  [ConfigKey.FilterCompletions]: undefined,
};

class BuildInfo {
  readonly packageJson: any = packageJson;

  isProduction(): boolean {
    return this.getBuildType() !== 'dev';
  }
  getBuildType(): string {
    return this.packageJson.buildType;
  }
  getVersion(): string {
    return this.packageJson.version;
  }
  getDisplayVersion(): string {
    return this.getBuildType() === 'dev' ? `${this.getVersion()}-dev` : this.getVersion();
  }
  getBuild(): string {
    return this.packageJson.build;
  }
  getName(): string {
    return this.packageJson.name;
  }
}

class EditorSession {
  constructor(
    readonly sessionId: string,
    readonly machineId: string,
    readonly remoteName = 'none',
    readonly uiKind = 'desktop'
  ) {}
}

abstract class EditorAndPluginInfo {
  abstract getEditorPluginInfo(): NameAndVersionType;
  abstract getEditorInfo(): EditorAndPluginInfo.EditorInfo;
  // not exists ./testing/context.ts
  // required ../../agent/src/methods/setEditorInfo.ts
  abstract setEditorAndPluginInfo(
    editorInfo: EditorAndPluginInfo.EditorInfo,
    editorPluginInfo?: NameAndVersionType,
    relatedPluginInfo?: NameAndVersionType[]
  ): void;
  abstract setCopilotIntegrationId(copilotIntegrationId: string): void;
  abstract getRelatedPluginInfo(): NameAndVersionType[];
  getCopilotIntegrationId(): EditorAndPluginInfo.IntegrationId | void {}
}

namespace EditorAndPluginInfo {
  export type IntegrationId = 'jetbrains-chat' | 'xcode-chat' | 'copilot-eclipse' | 'copilot-language-server';

  export type EditorInfo = NameAndVersionType & {
    // ../../agent/src/config.ts
    // name: 'unknown-editor' | string;
    // ./conversation/prompt/conversationPromptEngine.ts
    // readableName?: string;
    // version: string;
    // ./telemetry/failbot.ts
    devName?: string;
    // ./telemetry.ts
    root?: string;
  };
  // export type EditorPluginInfo = {
  //   // string ../../agent/src/methods/setEditorInfo.ts
  //   name: string;
  //   // | 'copilot-intellij'
  //   // | 'copilot.vim'
  //   // | 'copilot-vs'
  //   // // ../../agent/src/config.ts
  //   // | 'unknown-editor-plugin';
  //   version: string;
  //   // ../../agent/src/methods/setEditorInfo.ts
  //   readableName?: string;
  // };
}

const apiVersion = '2024-12-15';

const FALLBACK_GITHUB_APP_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

class GitHubAppInfo {
  githubAppId?: string;
  findAppIdToAuthenticate() {
    return this.githubAppId ?? FALLBACK_GITHUB_APP_CLIENT_ID;
  }
  fallbackAppId() {
    return FALLBACK_GITHUB_APP_CLIENT_ID;
  }
}

export {
  isProduction,
  ConfigValueType,
  editorVersionHeaders,
  EditorSession,
  GitHubAppInfo,
  EditorAndPluginInfo,
  formatNameAndVersion,
  getConfig,
  ConfigKey,
  getVersion,
  dumpForTelemetry,
  getBuild,
  getBuildType,
  BuildInfo,
  DefaultsOnlyConfigProvider,
  InMemoryConfigProvider,
  ConfigKeysByType,
  BlockModeConfig,
  shouldDoParsingTrimming,
  shouldDoServerTrimming,
  ConfigProvider,
  ConfigBlockModeConfig,
  getConfigKeyRecursively,
};
