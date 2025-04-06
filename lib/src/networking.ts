import * as util from 'node:util';
import type { Readable } from 'node:stream';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { AbortSignal, Headers } from '@adobe/helix-fetch';
import type { Context } from './context.ts';
import type { AbortController } from '@adobe/helix-fetch';

import { telemetry, TelemetryData } from './telemetry.ts';
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
  if (!e || typeof e != 'object') return false;
  return (
    e instanceof HttpTimeoutError ||
    e instanceof AbortError ||
    ('name' in e && e.name === 'AbortError') ||
    (e instanceof FetchError && e.code === 'ABORT_ERR')
  );
}

function isNetworkError(e: any, checkCause = true) {
  if (!(e instanceof Error)) {
    return false;
  }

  if (checkCause && 'cause' in e && isNetworkError(e.cause, false)) {
    return true;
  }

  return (
    e instanceof FetchError ||
    e.name === 'EditorFetcherError' ||
    e.name === 'FetchError' ||
    e instanceof JsonParseError ||
    e instanceof FetchResponseError ||
    (e?.message?.startsWith('net::') ?? false) ||
    networkErrorCodes.has((e as any).code ?? '')
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
  extraHeaders: Record<string, string> = {},
  timeout?: number
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

  let request: Request = { method: 'POST', headers, json: body as any, timeout };
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
    if (isInterruptedNetworkError(reason)) {
      throw reason;
    }
  }

  telemetry(ctx, 'networking.disconnectAll');
  await fetcher.disconnectAll();
  return fetcher.fetch(url, request);
}

function isInterruptedNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message === 'ERR_HTTP2_GOAWAY_SESSION') {
    return true;
  }

  if ('code' in error) {
    return error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ERR_HTTP2_INVALID_SESSION';
  }

  return false;
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

class HttpTimeoutError extends Error {
  readonly name = 'HttpTimeoutError';
  constructor(
    message: string,
    readonly cause: unknown
  ) {
    super(message);
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
  readonly ok: boolean;
  readonly clientError: boolean;

  constructor(
    readonly status: number,
    readonly statusText: string,
    // ./network/helix.ts
    // Iterable ../../agent/src/methods/testing/fetch.ts
    readonly headers: Headers,
    readonly getText: () => Promise<string>,
    // TODO:
    // ./openai/fetch.ts body.destory()
    // ./openai/stream.ts body.setEncoding('utf-8')
    // NodeJS.ReadableStream ./network/helix.ts
    // EditorFetcher -> node:stream.PassThrough -> ReadableBase.destroy -> NodeJS.ReadableStream
    // HelixFetcher -> NodeJS.ReadableStream
    readonly getBody: () => Readable
  ) {
    this.ok = this.status >= 200 && this.status < 300;
    this.clientError = this.status >= 400 && this.status < 500;
  }

  async text(): Promise<string> {
    return this.getText();
  }

  async json(): Promise<unknown> {
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
        const posMatch = e.message.match(/^(.*?) in JSON at position (\d+)(?: \(line \d+ column \d+\))?$/);
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
  body(): Readable {
    return this.getBody();
  }
}

export { FetchResponseError, Fetcher, HttpTimeoutError, Response, isAbortError, isNetworkError, postRequest, Request };
