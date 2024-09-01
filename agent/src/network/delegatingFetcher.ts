import { Context } from "../../../lib/src/context.ts";
import { InitializedNotifier } from "../editorFeatures/initializedNotifier.ts";
import { AgentConfigProvider } from "../config.ts";
import { getConfig, ConfigKey, ConfigValueType } from "../../../lib/src/config.ts";
import { Logger, LogLevel } from "../../../lib/src/logger.ts";
import { HelixFetcher } from "../../../lib/src/network/helix.ts";
import { EditorFetcher } from "../editorFeatures/fetcher.ts";
import { FallbackFetcher } from "./fallbackFetcher.ts";
import { Fetcher, Request } from "../../../lib/src/networking.ts";

const logger = new Logger(LogLevel.INFO, 'fetcher');

class AgentDelegatingFetcher extends Fetcher {
  currentFetcher: Fetcher;
  fallbackFetcher: FallbackFetcher;
  fetchStrategy: ConfigValueType[ConfigKey.FetchStrategy];
  editorFetcherCapability = false;

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

    ctx.get(InitializedNotifier).once((options) => {
      this.editorFetcherCapability = !!options.copilotCapabilities?.fetch;
      this.updateFetcher();
    });

    // MARK, probly better should just check config in a currentFetcher getter
    ctx.get(AgentConfigProvider).onConfigChange(ConfigKey.FetchStrategy, (value) => {
      this.fetchStrategy = value;
      this.updateFetcher();
    });

    this.fetchStrategy = getConfig(ctx, ConfigKey.FetchStrategy);
  }

  updateFetcher(): void {
    if (!this.editorFetcherCapability) {
      logger.debug(this.ctx, 'Using Helix fetcher, editor does not have fetch capability.');
      this.currentFetcher = this.helixFetcher;
      return;
    }
    if (this.fetchStrategy === 'client') {
      logger.debug(this.ctx, 'Using editor fetcher, fetch strategy set to client.');
      this.currentFetcher = this.editorFetcher;
      return;
    }
    if (this.fetchStrategy === 'native') {
      logger.debug(this.ctx, 'Using Helix fetcher, fetch strategy set to native.');
      this.currentFetcher = this.helixFetcher;
      return;
    }
    const debugUseEditorFetcher = getConfig(this.ctx, ConfigKey.DebugUseEditorFetcher);
    if (debugUseEditorFetcher?.toString() === 'true') {
      logger.debug(this.ctx, 'Using editor fetcher, debug flag is enabled.');
      this.currentFetcher = this.editorFetcher;
      return;
    }
    if (debugUseEditorFetcher?.toString() === 'false') {
      logger.debug(this.ctx, 'Using Helix fetcher, debug flag is disabled.');
      this.currentFetcher = this.helixFetcher;
      return;
    }
    logger.debug(this.ctx, 'Editor fetcher capability available, will fallback if needed.');
    this.currentFetcher = this.fallbackFetcher;
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
