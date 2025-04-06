import { Context } from '../../../lib/src/context.ts';
import { isAbortError, Fetcher, Request, Response } from '../../../lib/src/networking.ts';
import { Logger } from '../../../lib/src/logger.ts';

const logger = new Logger('fetcher');
const expRoot = 'https://default.exp-tas.com/';

class FallbackFetcher extends Fetcher {
  constructor(
    readonly ctx: Context,
    readonly defaultFetcher: Fetcher,
    readonly fallbackFetcher: Fetcher,
    readonly onFallbackSuccess: () => void
  ) {
    super();
  }

  async fetch(url: string, options?: Request): Promise<Response> {
    try {
      return await this.defaultFetcher.fetch(url, options);
    } catch (e) {
      if (isAbortError(e) || `${url}/`.startsWith(expRoot)) throw e;
      logger.info(this.ctx, `Request to <${url}> failed, attempting fallback.`, e);
      const response = await this.fallbackFetcher.fetch(url, options);
      this.onFallbackSuccess();
      return response;
    }
  }

  set proxySettings(value: Fetcher.ProxySetting) {
    this.defaultFetcher.proxySettings = value;
  }

  get proxySettings(): Fetcher.ProxySetting | undefined {
    return this.defaultFetcher.proxySettings;
  }

  get name(): string {
    return this.defaultFetcher.name;
  }

  async disconnectAll(): Promise<void> {
    return await this.defaultFetcher.disconnectAll();
  }

  makeAbortController() {
    return this.defaultFetcher.makeAbortController();
  }
}

export { FallbackFetcher };
