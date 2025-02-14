import {
  DefaultsOnlyConfigProvider,
  EditorAndPluginInfo,
  InMemoryConfigProvider,
  ConfigKey,
  type ConfigValueType,
} from '../../lib/src/config.ts';
import { NameAndVersionType } from '../../types/src/index.ts';

class AgentConfigProvider extends InMemoryConfigProvider {
  readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    super(new DefaultsOnlyConfigProvider(), {});
    this.env = { ...env };
    this.setOverridesFromEnvironment();
  }

  private _set<K extends keyof ConfigValueType>(
    key: K,
    envkey: string,
    formatter: (value: string | undefined) => ConfigValueType[K] | undefined
  ) {
    for (const prefix of ['AGENT_DEBUG_', 'GITHUB_COPILOT_', 'GH_COPILOT_']) {
      const _envKey = `${prefix}${envkey}`;
      if (_envKey in this.env) {
        this.setConfig(key, formatter(this.env[_envKey]));
      }
    }
  }

  setOverridesFromEnvironment(): void {
    this._set(ConfigKey.DebugOverrideEngine, 'OVERRIDE_ENGINE', (v) => v);
    this._set(ConfigKey.DebugOverrideProxyUrl, 'OVERRIDE_PROXY_URL', (v) => v);
    this._set(ConfigKey.DebugOverrideCapiUrl, 'OVERRIDE_CAPI_URL', (v) => v);
    this._set(ConfigKey.DebugUseEditorFetcher, 'USE_EDITOR_FETCHER', (v) => (v == 'true' || v == 'false' ? v : null));
    // this._set(ConfigKey.DebugOverrideRelatedFiles, 'OVERRIDE_RELATED_FILES', (v) => !!v);
  }
}

class AgentEditorInfo extends EditorAndPluginInfo {
  _editorInfo?: NameAndVersionType;
  _editorPluginInfo?: NameAndVersionType;
  _relatedPluginInfo?: NameAndVersionType[];

  setEditorAndPluginInfo(
    editorInfo: EditorAndPluginInfo.EditorInfo,
    editorPluginInfo: NameAndVersionType,
    relatedPluginInfo: NameAndVersionType[] = []
  ): void {
    this._editorInfo = editorInfo;
    this._editorPluginInfo = editorPluginInfo;
    this._relatedPluginInfo = relatedPluginInfo;
  }

  getEditorInfo(): EditorAndPluginInfo.EditorInfo {
    return this._editorInfo ? this._editorInfo : { name: 'unknown-editor', version: '0' };
  }

  getEditorPluginInfo(): NameAndVersionType {
    return this._editorPluginInfo ? this._editorPluginInfo : { name: 'unknown-editor-plugin', version: '0' };
  }

  getRelatedPluginInfo(): NameAndVersionType[] {
    return this._relatedPluginInfo ?? [];
  }
}

export { AgentConfigProvider, AgentEditorInfo };
