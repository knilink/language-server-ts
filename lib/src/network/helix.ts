import { Readable } from 'node:stream';
// @ts-ignore
import { context, type RequestOptions as HelixOptions, AbortController } from '@adobe/helix-fetch'; // has to be helix AbortController controller

import { type Context } from '../context.ts';

import { ProxySocketFactory } from './proxySockets.ts';
import { BuildInfo } from '../config.ts';
import { RootCertificateConfigurator, type RequestOptions } from './certificates.ts';
import { Fetcher, HttpTimeoutError, Response, Request } from '../networking.ts';

class HelixFetcher extends Fetcher {
  readonly name = 'HelixFetcher';
  fetchApi: ReturnType<typeof context>;
  readonly certificateConfigurator: RootCertificateConfigurator;
  readonly proxySocketFactory: ProxySocketFactory;
  _proxySettings?: Fetcher.ProxySetting;

  constructor(readonly ctx: Context) {
    super();
    this.fetchApi = this.createFetchApi(ctx);
    this.certificateConfigurator = new RootCertificateConfigurator(ctx);
    this.proxySocketFactory = ctx.get(ProxySocketFactory);
  }

  set proxySettings(value: Fetcher.ProxySetting) {
    this._proxySettings = value;
    this.fetchApi = this.createFetchApi(this.ctx);
  }

  get proxySettings(): Fetcher.ProxySetting | undefined {
    return this._proxySettings;
  }

  set rejectUnauthorized(value: boolean) {
    super.rejectUnauthorized = value;
    this.fetchApi = this.createFetchApi(this.ctx);
  }

  get rejectUnauthorized(): boolean | undefined {
    return super.rejectUnauthorized;
  }

  createSocketFactory(userSettings: Fetcher.ProxySetting, rejectUnauthorized?: boolean) {
    return async (requestOptions: RequestOptions): Promise<unknown> => {
      requestOptions.rejectUnauthorized = rejectUnauthorized;
      requestOptions.timeout = userSettings.connectionTimeoutInMs;
      await this.certificateConfigurator.applyToRequestOptions(requestOptions);
      const proxySettings = await this.certificateConfigurator.enhanceProxySettings(userSettings);
      return await this.proxySocketFactory.createSocket(requestOptions, proxySettings);
    };
  }

  createFetchApi(ctx: Context) {
    const buildInfo = ctx.get(BuildInfo);

    // super.rejectUnauthorized can be undefined so !== !super.rejectUnauthorized
    if (super.rejectUnauthorized === false) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    return context({
      userAgent: `GithubCopilot/${buildInfo.getVersion()}`,
      socketFactory: this._proxySettings
        ? this.createSocketFactory(this._proxySettings, super.rejectUnauthorized)
        : undefined,
      rejectUnauthorized: super.rejectUnauthorized,
    });
  }

  // MARK
  async fetch(url: string, options: RequestOptions & Extract<Request, { method: 'POST' }>): Promise<Response> {
    let signal = options.signal;
    let timedOut = false;
    if (options.timeout) {
      const abortController = this.makeAbortController();

      setTimeout(() => {
        abortController.abort();
        timedOut = true;
      }, options.timeout);

      options.signal?.addEventListener('abort', () => abortController.abort());

      if (options.signal?.aborted) {
        abortController.abort();
      }

      signal = abortController.signal;
    }
    const helixOptions = { ...options, body: options.body ? options.body : options.json, signal: signal };
    await this.certificateConfigurator.applyToRequestOptions(helixOptions);
    let certs = await this.certificateConfigurator.getCertificates();
    this.fetchApi.setCA(certs);
    const resp = await this.fetchApi.fetch(url, helixOptions).catch((e: unknown) => {
      throw timedOut ? new HttpTimeoutError(`Request to <${url}> timed out after ${options.timeout}ms`, e) : e;
    });
    return new Response(
      resp.status,
      resp.statusText,
      resp.headers,
      () => resp.text(),
      async () => resp.body // as Readable // MARK should be stream.Readable somehow declared as NodeJS.ReadableStream, f*
    );
  }

  async disconnectAll(): Promise<void> {
    this.fetchApi.reset();
  }

  makeAbortController(): AbortController {
    return new AbortController();
  }
}

export { HelixFetcher };
