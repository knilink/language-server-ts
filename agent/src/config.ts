import type { ConfigValueType } from '../../lib/src/config.ts';
import type { NameAndVersionType } from '../../types/src/index.ts';

import {
  ConfigKey,
  DefaultsOnlyConfigProvider,
  EditorAndPluginInfo,
  InMemoryConfigProvider,
} from '../../lib/src/config.ts';

function hasValidInfo(info: EditorAndPluginInfo): boolean {
  return info.getEditorPluginInfo().name !== unknownPlugin;
}

class AgentConfigProvider extends InMemoryConfigProvider {
  readonly env: NodeJS.ProcessEnv;
  readonly envSettings = new Map();

  constructor(env: NodeJS.ProcessEnv) {
    super(new DefaultsOnlyConfigProvider(), {});
    this.env = { ...env };
    this.setOverridesFromEnvironment();
  }

  private _set<K extends ConfigKey>(
    key: K,
    envkey: string,
    formatter: (value: string | undefined) => ConfigValueType[K] | undefined
  ) {
    for (const prefix of ['AGENT_DEBUG_', 'GITHUB_COPILOT_', 'GH_COPILOT_']) {
      const _envKey = `${prefix}${envkey}`;
      if (_envKey in this.env) {
        this.envSettings.set(key, formatter(this.env[_envKey]));
        this.setConfig(key, formatter(this.env[_envKey]));
      }
    }
  }

  setOverridesFromEnvironment(): void {
    this._set(ConfigKey.DebugOverrideEngine, 'OVERRIDE_ENGINE', (v) => v);
    this._set(ConfigKey.DebugOverrideProxyUrl, 'OVERRIDE_PROXY_URL', (v) => v);
    this._set(ConfigKey.DebugOverrideCapiUrl, 'OVERRIDE_CAPI_URL', (v) => v);
    this._set(ConfigKey.DebugUseEditorFetcher, 'USE_EDITOR_FETCHER', (v) => (v == 'true' || v == 'false' ? v : null));
    this._set(ConfigKey.UseSubsetMatching, 'USE_SUBNET_MATCHING', (v) => !!v);
    this._set(ConfigKey.ExcludeOpenTabFilesCSharp, 'EXCLUDE_OPEN_TAB_FILES_CSHARP', (v) => !!v);
    this._set(
      ConfigKey.FallbackToOpenTabFilesWithNoRelatedFiles,
      'FALLBACK_TO_OPEN_TAB_FILES_WITH_NO_RELATED_FILES',
      (v) => !!v
    );
  }

  setConfig<K extends ConfigKey>(key: K, value?: ConfigValueType[K]) {
    super.setConfig(key, value ?? this.envSettings.get(key));
  }
}

const unknownEditor = 'unknown-editor';
const unknownPlugin = 'unknown-editor-plugin';

class AgentEditorInfo extends EditorAndPluginInfo {
  _editorInfo?: NameAndVersionType;
  _editorPluginInfo?: NameAndVersionType;
  _relatedPluginInfo?: NameAndVersionType[];
  _copilotIntegrationId?: EditorAndPluginInfo.IntegrationId;

  setEditorAndPluginInfo(
    editorPluginInfo: NameAndVersionType,
    editorInfo: EditorAndPluginInfo.EditorInfo,
    relatedPluginInfo: NameAndVersionType[] = []
  ): void {
    this._editorInfo = editorInfo;
    this._editorPluginInfo = editorPluginInfo;
    this._relatedPluginInfo = relatedPluginInfo;
  }

  setCopilotIntegrationId(copilotIntegrationId: EditorAndPluginInfo.IntegrationId) {
    this._copilotIntegrationId = copilotIntegrationId;
  }

  getEditorInfo(): EditorAndPluginInfo.EditorInfo {
    return this._editorInfo ? this._editorInfo : { name: unknownEditor, version: '0' };
  }

  getEditorPluginInfo(): NameAndVersionType {
    return this._editorPluginInfo ? this._editorPluginInfo : { name: unknownPlugin, version: '0' };
  }

  getRelatedPluginInfo(): NameAndVersionType[] {
    return this._relatedPluginInfo ?? [];
  }

  getCopilotIntegrationId(): EditorAndPluginInfo.IntegrationId | undefined {
    return this._copilotIntegrationId;
  }
}

export { AgentConfigProvider, AgentEditorInfo, hasValidInfo };
