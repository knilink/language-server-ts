import { BlockMode, TelemetryProperties } from './types.ts';
import { Context } from './context.ts';
import { LogLevel } from './logger.ts';

import { LanguageId } from '../../prompt/src/types.ts';
import { TelemetryWithExp } from './telemetry.ts';

import { isSupportedLanguageId } from '../../prompt/src/parse.ts';
import { CopilotConfigPrefix } from './constants.ts';
import { Features } from './experiments/features.ts';
import { EventEmitter } from 'node:events';

function shouldDoParsingTrimming(blockMode: BlockMode) {
  return ['parsing', 'parsingandserver'].includes(blockMode);
}

enum ConfigKey {
  Enable = 'enable',
  InlineSuggestEnable = 'inlineSuggest.enable',
  ShowEditorCompletions = 'editor.showEditorCompletions',
  EnableAutoCompletions = 'editor.enableAutoCompletions',
  DelayCompletions = 'editor.delayCompletions',
  FilterCompletions = 'editor.filterCompletions',
  FetchStrategy = 'fetchStrategy',
  DebugOverrideCppHeaders = 'advanced.debug.overrideCppHeaders',
  DebugOverrideRelatedFiles = 'advanced.debug.overrideRelatedFiles',
  DebugOverrideCapiUrl = 'advanced.debug.overrideCapiUrl',
  DebugTestOverrideCapiUrl = 'advanced.debug.testOverrideCapiUrl',
  DebugOverrideProxyUrl = 'advanced.debug.overrideProxyUrl',
  DebugTestOverrideProxyUrl = 'advanced.debug.testOverrideProxyUrl',
  DebugOverrideEngine = 'advanced.debug.overrideEngine',
  DebugOverrideLogLevels = 'advanced.debug.overrideLogLevels',
  DebugFilterLogCategories = 'advanced.debug.filterLogCategories',
  DebugSnippyOverrideUrl = 'advanced.debug.codeRefOverrideUrl',
  DebugUseElectronFetcher = 'advanced.debug.useElectronFetcher',
  DebugUseEditorFetcher = 'advanced.debug.useEditorFetcher',
}

// MARK guess should all be strings
type DefaultConvigValueType = {
  [ConfigKey.DebugOverrideCppHeaders]: boolean;
  [ConfigKey.DebugOverrideRelatedFiles]: boolean;
  // ../../agent/src/config.ts
  // ../../agent/src/network/delegatingFetcher.ts
  [ConfigKey.DebugUseEditorFetcher]: 'true' | 'false' | null; // boolean | string; debugUseEditorFetcher.toString() === 'true'
  [ConfigKey.DebugUseElectronFetcher]: unknown | null;
  [ConfigKey.DebugOverrideLogLevels]: Partial<{
    '*': LogLevel;
    [key: string]: LogLevel;
  }>;
  [ConfigKey.DebugSnippyOverrideUrl]: string;
  // ../../agent/src/network/delegatingFetcher.ts
  [ConfigKey.FetchStrategy]: 'auto' | 'client' | 'native';
  [ConfigKey.ShowEditorCompletions]: boolean | undefined;
  [ConfigKey.DelayCompletions]: boolean | undefined;
  [ConfigKey.FilterCompletions]: boolean | undefined;
};

type AdditionalConfigValueType = {
  [ConfigKey.Enable]: { '*': boolean; plaintext: boolean; markdown: boolean; scminput: boolean };
  [ConfigKey.InlineSuggestEnable]: boolean;
  // undefined ../../agent/src/methods/notifyChangeConfiguration.ts
  [ConfigKey.EnableAutoCompletions]: boolean;
  [ConfigKey.DebugOverrideCapiUrl]: string;
  [ConfigKey.DebugTestOverrideCapiUrl]: string;
  [ConfigKey.DebugOverrideProxyUrl]: string;
  [ConfigKey.DebugTestOverrideProxyUrl]: string;
  [ConfigKey.DebugOverrideEngine]: string;

  // string ./logger.ts
  [ConfigKey.DebugFilterLogCategories]: string[]; // ../../package.json.js
};

type ConfigValueType = DefaultConvigValueType & AdditionalConfigValueType;

const hardCodedConfigDefaults: DefaultConvigValueType = {
  [ConfigKey.DebugOverrideCppHeaders]: false,
  [ConfigKey.DebugOverrideRelatedFiles]: false,
  [ConfigKey.DebugUseEditorFetcher]: null,
  [ConfigKey.DebugUseElectronFetcher]: null,
  [ConfigKey.DebugOverrideLogLevels]: {},
  [ConfigKey.DebugSnippyOverrideUrl]: '',
  [ConfigKey.FetchStrategy]: 'auto',
  [ConfigKey.ShowEditorCompletions]: undefined,
  [ConfigKey.DelayCompletions]: undefined,
  [ConfigKey.FilterCompletions]: undefined,
};

type ConfigKeysByType<U> = {
  [K in keyof ConfigValueType]: ConfigValueType[K] extends U ? K : never;
}[keyof ConfigValueType];

function shouldDoServerTrimming(blockMode: BlockMode) {
  return ['server', 'parsingandserver'].includes(blockMode);
}

function toApplicableBlockMode(blockMode: BlockMode, languageId: LanguageId): BlockMode {
  switch (blockMode) {
    case 'parsing':
      return isSupportedLanguageId(languageId) ? 'parsing' : 'server';
    case 'server':
      return 'server';
    case 'parsingandserver':
    default:
      return isSupportedLanguageId(languageId) ? 'parsingandserver' : 'server';
  }
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
  if (key in configDefaults) return configDefaults[key];
  throw new Error(`Missing config default value: ${CopilotConfigPrefix}.${key}`);
}

function getOptionalConfigDefaultForKey<K extends ConfigKey>(key: K): ConfigValueType[K] | undefined {
  if (key in configDefaults) return configDefaults[key];
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
    'Editor-Version': formatNameAndVersion(info.getEditorInfo()),
    'Editor-Plugin-Version': formatNameAndVersion(info.getEditorPluginInfo()),
    'Copilot-Language-Server-Version': getVersion(ctx),
  };
}

abstract class BlockModeConfig {
  abstract forLanguage(ctx: Context, languageId: LanguageId, telemetryData: TelemetryWithExp): Promise<BlockMode>;
}

class ConfigBlockModeConfig extends BlockModeConfig {
  async forLanguage(ctx: Context, languageId: LanguageId, telemetryData: TelemetryWithExp): Promise<BlockMode> {
    let overrideBlockMode = ctx.get(Features).overrideBlockMode(telemetryData);
    if (overrideBlockMode) return toApplicableBlockMode(overrideBlockMode, languageId);
    if (languageId == 'ruby') return 'parsing';
    if (isSupportedLanguageId(languageId)) return 'parsingandserver';
    return 'server';
  }
}

abstract class ConfigProvider {
  abstract getConfig<K extends ConfigKey>(key: K): ConfigValueType[K];
  abstract getOptionalConfig<K extends ConfigKey>(key: K): ConfigValueType[K] | undefined;
  abstract dumpForTelemetry(): TelemetryProperties;
  abstract getLanguageConfig(key: ConfigKey, language?: LanguageId): unknown;
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
  getLanguageConfig(key: ConfigKey, language?: LanguageId): unknown {
    const obj: any = this.getConfig(key); // MARK
    return language && language in obj ? obj[language] : obj['*'];
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
  getLanguageConfig(key: ConfigKey, languageId?: LanguageId): unknown {
    let value: any = this.overrides[key]; // MARK
    if (value !== undefined) {
      if (languageId !== undefined) {
        return value[languageId];
      } else {
        return value['*'];
      }
    }
    return this.baseConfigProvider.getLanguageConfig(key, languageId);
  }
}

// import packageJson from '../../package.json.js';
// // TODO;
// for (const key of Object.values(ConfigKey)) {
//   let conf = packageJson.contributes.configuration[0];
//   const parents = [];
//   const segments = `${CopilotConfigPrefix}.${key}`.split('.');
//   while (segments.length > 0) {
//     parents.push(segments.shift());
//     let maybeChild = conf.properties[parents.join('.')];
//     if (isContributesObject(maybeChild)) {
//       parents.length = 0;
//       conf = maybeChild;
//     } else if (segments.length == 0 && maybeChild?.default !== undefined) {
//       if (key in configDefaults) throw new Error(`Duplicate config default value ${CopilotConfigPrefix}.${key}`);
//       (configDefaults as any)[key] = maybeChild.default; // MARK
//     }
//   }
//   if (!(key in configDefaults)) throw new Error(`Missing config default value ${CopilotConfigPrefix}.${key}`);
// }

const packageJsonDefaultConfig: AdditionalConfigValueType = {
  [ConfigKey.Enable]: { '*': true, plaintext: false, markdown: false, scminput: false },
  [ConfigKey.InlineSuggestEnable]: true,
  // undefined ../../agent/src/methods/notifyChangeConfiguration.ts
  [ConfigKey.EnableAutoCompletions]: true,
  [ConfigKey.DebugOverrideCapiUrl]: '',
  [ConfigKey.DebugTestOverrideCapiUrl]: '',
  [ConfigKey.DebugOverrideProxyUrl]: '',
  [ConfigKey.DebugTestOverrideProxyUrl]: '',
  [ConfigKey.DebugOverrideEngine]: '',

  [ConfigKey.DebugFilterLogCategories]: [],
};

const configDefaults: ConfigValueType = { ...hardCodedConfigDefaults, ...packageJsonDefaultConfig };

// class BuildInfo {
//   readonly packageJson: any = packageJson;
//
//   isProduction(): boolean {
//     return this.getBuildType() !== 'dev';
//   }
//   getBuildType(): string {
//     return this.packageJson.buildType;
//   }
//   getVersion(): string {
//     return this.packageJson.version;
//   }
//   getDisplayVersion(): string {
//     return this.getBuildType() === 'dev' ? `${this.getVersion()}-dev` : this.getVersion();
//   }
//   getBuild(): string {
//     return this.packageJson.build;
//   }
//   getName(): string {
//     return this.packageJson.name;
//   }
// }

class BuildInfo {
  isProduction(): boolean {
    return this.getBuildType() !== 'dev';
  }
  getBuildType(): string {
    return 'prod';
  }
  getVersion(): string {
    return '1.211.0';
  }
  getDisplayVersion(): string {
    return this.getBuildType() === 'dev' ? `${this.getVersion()}-dev` : this.getVersion();
  }
  getBuild(): string {
    return '970';
  }
  getName(): string {
    return 'copilot';
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

namespace EditorAndPluginInfo {
  export type EditorInfo = {
    // ../../agent/src/config.ts
    name: 'unknown-editor' | string;
    // ./conversation/prompt/conversationPromptEngine.ts
    readableName?: string;
    version: string;
    // ./telemetry/failbot.ts
    devName?: string;
    // ./telemetry.ts
    root?: string;
  };
  export type EditorPluginInfo = {
    // string ../../agent/src/methods/setEditorInfo.ts
    name: string;
    // | 'copilot-intellij'
    // | 'copilot.vim'
    // | 'copilot-vs'
    // // ../../agent/src/config.ts
    // | 'unknown-editor-plugin';
    version: string;
    // ../../agent/src/methods/setEditorInfo.ts
    readableName?: string;
  };
}

abstract class EditorAndPluginInfo {
  abstract getEditorPluginInfo(): EditorAndPluginInfo.EditorPluginInfo;
  abstract getEditorInfo(): EditorAndPluginInfo.EditorInfo;
  abstract setEditorAndPluginInfo(
    editorInfo: EditorAndPluginInfo.EditorInfo,
    editorPluginInfo: EditorAndPluginInfo.EditorPluginInfo
  ): void;
}

const FALLBACK_GITHUB_APP_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

class GitHubAppInfo {
  githubAppId?: string;
  findAppIdToAuthenticate() {
    return this.githubAppId ?? FALLBACK_GITHUB_APP_CLIENT_ID;
  }
  fallbackAppId() {
    return FALLBACK_GITHUB_APP_CLIENT_ID;
  }
  experimentalJetBrainsAppId() {
    return 'Iv23ctfURkiMfJ4xr5mv';
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
