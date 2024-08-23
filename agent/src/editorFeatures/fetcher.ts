import { PassThrough } from 'node:stream';
import { STATUS_CODES } from 'node:http';
import {
  ProtocolRequestType,
  ProgressType,
  WorkDoneProgressBegin,
  WorkDoneProgressReport,
  WorkDoneProgressEnd,
} from 'vscode-languageserver/node';

import { Context } from '../../../lib/src/context';
import { BuildInfo } from '../../../lib/src/config';
import { Service } from '../service';
import { AbortError, Headers } from '@adobe/helix-fetch';
import { CancellationTokenSource } from '../cancellation';
import { Fetcher, Response } from '../../../lib/src/networking';

type FetchRequestParams = {
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeout?: number;
  method?: string;
  workDoneToken: string;
};

interface FetchProgressReport extends WorkDoneProgressReport {
  chunk: Buffer;
}
interface FetchProgressEnd extends WorkDoneProgressEnd {
  error?: string;
}

type FetchProgress = WorkDoneProgressBegin | FetchProgressReport | FetchProgressEnd;

type FetchResult = { status: number };

const DEFAULT_TIMEOUT_MS = 300_000;
const FetchRequestType = new ProtocolRequestType<FetchRequestParams, FetchResult, FetchProgress, unknown, unknown>(
  'copilot/fetch'
);
const FetchCancelRequestType = new ProtocolRequestType('copilot/fetchCancel');
const FetchProgressType = new ProgressType<FetchProgress>();
const FetchDisconnectAllRequestType = new ProtocolRequestType('copilot/fetchDisconnectAll');

function consumeStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const output: Buffer[] = [];
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(Buffer.concat(output).toString());
    });
    stream.on('data', (data: Buffer) => output.push(data));
  });
}

function convertOptionsToParams(
  url: string,
  workDoneToken: string,
  options: { timeout?: number; method?: string; headers?: Record<string, string>; json?: unknown; body?: string }
): FetchRequestParams {
  const { timeout, method } = options;
  let headers = options.headers ?? {};
  const body: string | undefined = options.json ? JSON.stringify(options.json) : options.body;

  if (options.json) {
    headers['content-type'] = 'application/json';
  }

  return { url, headers, body, timeout, method, workDoneToken };
}

class EditorFetcherError extends Error {
  readonly name = 'EditorFetcherError';
}

type Options = {
  headers: Record<string, string>;
  timeout: number;
  signal: AbortSignal;
};

class EditorFetcher extends Fetcher {
  proxySettings: undefined;

  readonly name = 'EditorFetcher';
  readonly userAgent: string;

  constructor(readonly ctx: Context) {
    super();
    const buildInfo = ctx.get(BuildInfo);
    this.userAgent = `GithubCopilot/${buildInfo.getVersion()}`;
  }

  async disconnectAll(): Promise<void> {
    await this.ctx.get(Service).connection.sendRequest(FetchDisconnectAllRequestType, {});
  }

  makeAbortController(): AbortController {
    return new AbortController();
  }

  async fetch(url: string, options: Partial<Options> = {}): Promise<Response> {
    // options = { ...options };
    if (!options.headers) options.headers = {};
    const { headers } = options;
    headers['user-agent'] = this.userAgent;
    options.timeout ??= DEFAULT_TIMEOUT_MS;

    let { signal } = options;
    const connection = this.ctx.get(Service).connection;
    const workDoneToken = crypto.randomUUID();
    const source = new CancellationTokenSource();
    const bodyStream = new PassThrough();

    const sendCancelRequest = () => {
      connection.sendRequest(FetchCancelRequestType, { workDoneToken });
    };

    const destroyBodyStream = () => {
      bodyStream.emit('error', new AbortError('EditorFetch request aborted'));
      bodyStream.end();
    };

    if (signal) {
      if (!(signal instanceof AbortSignal))
        throw new EditorFetcherError('EditorFetcher received unexpected abort signal');
      if (signal.aborted) throw new AbortError('EditorFetcher signal aborted before fetch');
      signal.addEventListener('abort', sendCancelRequest);
    }

    connection.onProgress(
      FetchProgressType, // MARK should be better FetchRequestType?
      workDoneToken,
      (progress) => {
        if (progress.kind === 'end') {
          signal?.removeEventListener('abort', sendCancelRequest);
          signal?.removeEventListener('abort', destroyBodyStream);
          if (progress.error) bodyStream.emit('error', new EditorFetcherError(progress.error));
          bodyStream.end();
        } else if (progress.kind === 'report') {
          bodyStream.write(progress.chunk);
        }
      }
    );

    let result: FetchResult;
    try {
      result = await new Promise<FetchResult>((resolve, reject) => {
        setTimeout(() => {
          reject(new EditorFetcherError('Request timed out from lsp server'));
        }, options.timeout);

        const rejectIfAborted = () => {
          reject(new AbortError('EditorFetcher request aborted'));
        };

        signal?.addEventListener('abort', rejectIfAborted);

        connection
          .sendRequest(FetchRequestType, convertOptionsToParams(url, workDoneToken, options), source.token)
          .then(resolve)
          .catch((error: unknown) => {
            let message = 'EditorFetcher request failed';
            const errorMessage = (error as Error).message;
            if (errorMessage) message += `: ${errorMessage}`;
            reject(new EditorFetcherError(message));
          })
          .finally(() => signal?.removeEventListener('abort', rejectIfAborted));
      });
    } catch (error) {
      return Promise.reject(error);
    }

    if (!result) throw new EditorFetcherError('EditorFetcher received invalid response');

    signal?.addEventListener('abort', destroyBodyStream);

    return new Response(
      result.status,
      STATUS_CODES[result.status] ?? '',
      new Headers(headers),
      async () => consumeStream(bodyStream),
      async () => bodyStream
    );
  }
}

export {
  DEFAULT_TIMEOUT_MS,
  FetchRequestType,
  FetchCancelRequestType,
  FetchDisconnectAllRequestType,
  EditorFetcherError,
  EditorFetcher,
};
