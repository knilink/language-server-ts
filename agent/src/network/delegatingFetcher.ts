import { Context } from '../../../lib/src/context.ts';
import { InitializedNotifier } from '../editorFeatures/initializedNotifier.ts';
import { AgentConfigProvider } from '../config.ts';
import { CopilotCapabilitiesProvider } from '../editorFeatures/capabilities.ts';
import { getConfig, ConfigKey, ConfigValueType } from '../../../lib/src/config.ts';
import { Logger } from '../../../lib/src/logger.ts';
import { HelixFetcher } from '../../../lib/src/network/helix.ts';
import { EditorFetcher } from '../editorFeatures/fetcher.ts';
import { FallbackFetcher } from './fallbackFetcher.ts';
import { Fetcher, Request } from '../../../lib/src/networking.ts';

const logger = new Logger('fetcher');

class AgentDelegatingFetcher extends Fetcher {
  currentFetcher: Fetcher;
  fallbackFetcher: FallbackFetcher;
  fetchStrategy: ConfigValueType[ConfigKey.FetchStrategy];

  constructor(
    readonly ctx: Context,
    readonly helixFetcher = new HelixFetcher(ctx),
    readonly editorFetcher = new EditorFetcher(ctx)
  ) {
    super();
    this.currentFetcher = this.helixFetcher;
    this.fallbackFetcher = new FallbackFetcher(ctx, helixFetcher, editorFetcher, () => {
      logger.info(this.ctx, 'Fallback fetch succeeded, switching to editor fetcher.');
      this.currentFetcher = this.editorFetcher;
    });

    ctx.get(InitializedNotifier).once(() => {
      this.updateFetcher();
    });

    // MARK, probly better should just check config in a currentFetcher getter
    ctx.get(AgentConfigProvider).onConfigChange(ConfigKey.FetchStrategy, (value) => {
      this.fetchStrategy = value;
      this.updateFetcher();
    });

    this.fetchStrategy = getConfig(ctx, ConfigKey.FetchStrategy);
  }

  get editorFetcherCapability() {
    return this.ctx.get(CopilotCapabilitiesProvider).getCapabilities().fetch ?? false;
  }

  updateFetcher(): void {
    let newFetcher;
    let message;
    if (!this.editorFetcherCapability) {
      message = 'Using Helix fetcher, editor does not have fetch capability.';
      newFetcher = this.helixFetcher;
    } else if (this.fetchStrategy === 'client') {
      message = 'Using editor fetcher, fetch strategy set to client.';
      newFetcher = this.editorFetcher;
    } else if (this.fetchStrategy === 'native') {
      message = 'Using Helix fetcher, fetch strategy set to native.';
      newFetcher = this.helixFetcher;
    } else {
      let debugUseEditorFetcher = getConfig(this.ctx, ConfigKey.DebugUseEditorFetcher);

      if (debugUseEditorFetcher?.toString() === 'true') {
        message = 'Using editor fetcher, debug flag is enabled.';
        newFetcher = this.editorFetcher;
      } else {
        if (debugUseEditorFetcher?.toString() === 'false') {
          message = 'Using Helix fetcher, debug flag is disabled.';
          newFetcher = this.helixFetcher;
        } else {
          message = 'Editor fetcher capability available, will fallback if needed.';
          newFetcher = this.fallbackFetcher;
        }
      }
    }

    if (this.currentFetcher !== newFetcher) {
      logger.debug(this.ctx, message);
      this.currentFetcher = newFetcher;
    }
  }

  get name(): string {
    return this.currentFetcher.name;
  }

  set proxySettings(value: Fetcher.ProxySetting) {
    this.helixFetcher.proxySettings = value;
  }

  get proxySettings(): Fetcher.ProxySetting | undefined {
    return this.helixFetcher.proxySettings;
  }

  set rejectUnauthorized(value: boolean) {
    super.rejectUnauthorized = value;
    this.helixFetcher.rejectUnauthorized = value;
  }

  get rejectUnauthorized(): boolean | undefined {
    return super.rejectUnauthorized;
  }

  async fetch(url: string, options?: Request) {
    return await this.currentFetcher.fetch(url, options);
  }

  async disconnectAll(): Promise<void> {
    await this.currentFetcher.disconnectAll();
  }

  makeAbortController() {
    return this.currentFetcher.makeAbortController();
  }
}

export { AgentDelegatingFetcher };
