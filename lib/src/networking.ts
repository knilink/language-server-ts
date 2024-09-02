import * as util from 'node:util';
import * as http from 'node:http';
import { Readable } from 'node:stream';
import { Context } from './context.ts';
import { CancellationToken } from '../../agent/src/cancellation.ts'; // MARK

import { telemetry, TelemetryData } from './telemetry.ts';
// @ts-ignore
import { FetchError, AbortError } from '@adobe/helix-fetch';
import { HeaderContributors } from './headerContributors.ts';
import { editorVersionHeaders, EditorSession } from './config.ts';

type Request = {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
} & (
  | {
      method?: 'GET';
    }
  | {
      method: 'POST';
      // ./helix.ts
      // ./snippy/network.ts
      body: string | object;
      json?: never;
    }
  | {
      method: 'POST';
      body?: never;
      // ./helix.ts
      json: object;
    }
);

const requestTimeoutMs = 30_000;

const networkErrorCodes = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTCONN',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ERR_HTTP2_STREAM_ERROR',
  'ERR_SSL_BAD_DECRYPT',
  'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
  'ERR_SSL_INVALID_LIBRARY_(0)',
  'ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function isAbortError(e: any) {
  return e instanceof AbortError || e.name === 'AbortError' || (e instanceof FetchError && e.code === 'ABORT_ERR');
}

function isNetworkError(e: any, checkCause = true) {
  if (checkCause && e.cause) {
    e = e.cause;
  }
  return (
    // (e instanceof Error && networkErrorCodes_fDe.has(e.code))
    e instanceof FetchError ||
    (e instanceof Error && e.name === 'EditorFetcherError') ||
    (e instanceof Error && e.name === 'FetchError') ||
    e instanceof JsonParseError ||
    e instanceof FetchResponseError ||
    e?.message?.startsWith('net::') ||
    (e instanceof Error && networkErrorCodes.has((e as any).code))
  );
}

async function postRequest(
  ctx: Context,
  url: string,
  secretKey: string,
  intent?: string,
  requestId?: string,
  body?: unknown,
  cancelToken?: CancellationToken,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  let headers: Record<string, string> = {
    ...extraHeaders,
    Authorization: util.format(`Bearer ${secretKey}`),
    // 'X-Request-Id': requestId
    ...(requestId === undefined ? {} : { 'X-Request-Id': requestId }),
    'Openai-Organization': 'github-copilot',
    'VScode-SessionId': ctx.get(EditorSession).sessionId,
    'VScode-MachineId': ctx.get(EditorSession).machineId,
    ...editorVersionHeaders(ctx),
  };

  ctx.get(HeaderContributors).contributeHeaders(url, headers);
  if (intent) {
    headers['OpenAI-Intent'] = intent;
  }

  let request: Request = { method: 'POST', headers, json: body as any, timeout: requestTimeoutMs };
  const fetcher = ctx.get(Fetcher);

  if (cancelToken) {
    const abortController = fetcher.makeAbortController();
    cancelToken.onCancellationRequested(() => {
      // telemetry(ctx, 'networking.cancelRequest', TelemetryData.createAndMarkAsIssued({ headerRequestId: requestId }));
      telemetry(
        ctx,
        'networking.cancelRequest',
        TelemetryData.createAndMarkAsIssued(requestId ? { headerRequestId: requestId } : {})
      );
      abortController.abort();
    });
    request.signal = abortController.signal;
  }

  try {
    return await fetcher.fetch(url, request);
  } catch (reason: any) {
    if (
      reason.code !== 'ECONNRESET' &&
      reason.code !== 'ETIMEDOUT' &&
      reason.code !== 'ERR_HTTP2_INVALID_SESSION' &&
      reason.message !== 'ERR_HTTP2_GOAWAY_SESSION'
    ) {
      throw reason;
    }
  }

  telemetry(ctx, 'networking.disconnectAll');
  await fetcher.disconnectAll();
  return fetcher.fetch(url, request);
}

namespace Fetcher {
  export type ProxySetting = {
    // ./diagnostics.ts
    host: string;
    // ./diagnostics.ts
    port: number;
    // ./network/proxySockets.ts
    // optional ./network/proxy.ts
    proxyAuth?: string; // base64
    // ./network/proxySockets.ts
    // optional ./network/proxy.ts
    kerberosServicePrincipal?: string;
    ca?: readonly string[];
    // ./network/helix.ts
    connectionTimeoutInMs?: number;
  };
}

abstract class Fetcher {
  abstract readonly name: string;

  abstract proxySettings?: Fetcher.ProxySetting;
  // abstract get proxySettings(): Fetcher.ProxySetting | undefined;
  // abstract set proxySettings(value: Fetcher.ProxySetting | undefined);

  // helix-fetcher's AbortController is not compatible with node's
  abstract makeAbortController(): AbortController;
  abstract fetch(input: string, init?: Request): Promise<Response>;
  abstract disconnectAll(): Promise<void>;

  private _rejectUnauthorized?: boolean;
  set rejectUnauthorized(
    value:
      | boolean
      // ../../agent/src/methods/notifyChangeConfiguration.ts
      | undefined
  ) {
    this._rejectUnauthorized = value;
  }
  get rejectUnauthorized(): boolean | undefined {
    return this._rejectUnauthorized;
  }
}

class JsonParseError extends SyntaxError {
  readonly name = 'JsonParseError';
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

class FetchResponseError extends Error {
  readonly name = 'FetchResponseError';
  readonly code: string;

  constructor(response: Response) {
    super(`HTTP ${response.status} ${response.statusText}`);
    this.code = `HTTP${response.status}`;
  }
}

class Response {
  constructor(
    readonly status: number,
    readonly statusText: string,
    // ./network/helix.ts
    // Iterable ../../agent/src/methods/testing/fetch.ts
    readonly headers: Pick<Headers, 'get'> & Iterable<[string, string]>, // MARK fuck this
    readonly getText: () => Promise<string>,
    // TODO:
    // ./openai/fetch.ts body.destory()
    // ./openai/stream.ts body.setEncoding('utf-8')
    // NodeJS.ReadableStream ./network/helix.ts
    // EditorFetcher -> node:stream.PassThrough -> ReadableBase.destroy -> NodeJS.ReadableStream
    // HelixFetcher -> NodeJS.ReadableStream
    readonly getBody: () => Promise<Readable>,
    readonly getJson?: () => Promise<unknown>
  ) {
    this.ok = this.status >= 200 && this.status < 300;
  }

  readonly ok: boolean;

  async text(): Promise<string> {
    return this.getText();
  }

  async json(): Promise<unknown> {
    if (this.getJson) return this.getJson();
    const text = await this.text();
    const contentType = this.headers.get('content-type');
    if (!contentType || !contentType.includes('json')) {
      throw new JsonParseError(
        `Response content-type is ${contentType ?? 'missing'} (status=${this.status})`,
        `ContentType=${contentType}`
      );
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      if (e instanceof SyntaxError) {
        const posMatch = e.message.match(/^(.*?) in JSON at position (\d+)$/);
        if ((posMatch && parseInt(posMatch[2], 10) == text.length) || e.message === 'Unexpected end of JSON input') {
          const actualLength = new TextEncoder().encode(text).length;
          const headerLength = this.headers.get('content-length');
          throw headerLength === null
            ? new JsonParseError(`Response body truncated: actualLength=${actualLength}`, 'Truncated')
            : new JsonParseError(
                `Response body truncated: actualLength=${actualLength}, headerLength=${headerLength}`,
                'Truncated'
              );
        }
      }
      throw e;
    }
  }

  // Readable.destory() ./conversation/openai/fetch.ts
  async body(): Promise<Readable> {
    return this.getBody();
  }
}

export { Fetcher, Request, Response, isNetworkError, FetchResponseError, postRequest, isAbortError };
