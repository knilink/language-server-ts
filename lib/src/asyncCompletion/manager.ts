import * as timers from 'timers/promises';
import type { Context } from '../context.ts';
import type { APIChoice } from '../openai/openai.ts';
import type { CompletionResult } from '../types.ts';

import { onCopilotToken } from '../auth/copilotTokenNotifier.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { iterableMap } from '../common/iterableHelpers.ts';
import { ConfigKey, getConfig } from '../config.ts';
import { Features } from '../experiments/features.ts';
import { Logger } from '../logger.ts';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryWithExp } from '../telemetry.ts';

interface Prompt {
  prefix: string;
  suffix: string;
}

enum RequestState {
  PENDING = 0,
  COMPLETED = 1,
  ERROR = 2,
}

interface PendingRequest {
  id: string;
  state: RequestState.PENDING;
  prompt: Prompt;
  promise: Promise<CompletedRequest | ErrorRequest>;
}

interface ErrorRequest {
  id: string;
  state: RequestState.ERROR;
}

interface CompletedRequest {
  id: string;
  prompt: Prompt;
  state: RequestState.COMPLETED;
  promise: Promise<CompletedRequest>;
  choice: APIChoice;
  allChoicesPromise: Promise<void>;
  result: CompletionResult<[APIChoice, Promise<void>]>;
}

type Request = PendingRequest | CompletedRequest | ErrorRequest;

const ASYNC_COMPLETION_WAIT_TIMEOUT = 100;
class AsyncCompletionManager {
  private _hasKnownOrg = false;
  private _logger = new Logger('AsyncCompletionManager');
  private _requests = new LRUCacheMap<
    Request['id'],
    Request // MARK: PendingRequest | CompletedRequest only
  >(100);

  constructor(readonly ctx: Context) {
    onCopilotToken(ctx, (token) => {
      this._hasKnownOrg = token.hasKnownOrg;
    });
  }

  clear() {
    this._requests.clear();
  }
  isEnabled(telemetryWithExp: TelemetryWithExp): boolean {
    const config = getConfig(this.ctx, ConfigKey.UseAsyncCompletions);
    return this._hasKnownOrg && typeof config == 'boolean'
      ? config
      : this.ctx.get(Features).enableAsyncCompletions(telemetryWithExp);
  }
  shouldWaitForAsyncCompletions(prompt: Prompt) {
    for (const request of this.getMatchingRequests(prompt))
      switch (request.state) {
        case RequestState.PENDING:
          this._logger.debug(this.ctx, 'Pending response, should wait before requesting completion');
          return false;
        case RequestState.COMPLETED: {
          const remainingPrefix = prompt.prefix.substring(request.prompt.prefix.length);
          if (request.choice.completionText.startsWith(remainingPrefix)) {
            this._logger.debug(this.ctx, 'Found matching async completion, should not request completion');
            return false;
          }
        }
      }
    this._logger.debug(this.ctx, 'No async completions found, should request completion');
    return true;
  }
  async queueCompletionRequest(
    prompt: Prompt,
    resultPromise: Promise<CompletionResult<[APIChoice, Promise<void>]>>
  ): Promise<ErrorRequest | CompletedRequest> {
    const id = uuidv4();

    const promise: Promise<ErrorRequest | CompletedRequest> = resultPromise
      .then((result): ErrorRequest | CompletedRequest => {
        if (result.type !== 'success') {
          this._requests.delete(id);
          return { id, state: RequestState.ERROR };
        }
        const completed: CompletedRequest = {
          id,
          prompt,
          choice: result.value[0],
          result,
          promise: promise as Promise<CompletedRequest>, // MARK: f*
          state: RequestState.COMPLETED,
          allChoicesPromise: result.value[1],
        };
        this._requests.set(id, completed);
        return completed;
      })
      .catch((e: unknown): ErrorRequest => {
        this._logger.error(this.ctx, 'Error in async completion request', e);
        this._requests.delete(id);
        return { id, state: RequestState.ERROR };
      });

    this._requests.set(id, { id, prompt, state: RequestState.PENDING, promise });
    return promise;
  }

  async getFirstMatchingRequestWithTimeout(prompt: Prompt) {
    return Promise.race([
      this.getFirstMatchingRequest(prompt),
      timers.setTimeout(ASYNC_COMPLETION_WAIT_TIMEOUT, undefined),
    ]);
  }

  async getFirstMatchingRequest(prompt: Prompt): Promise<[APIChoice, Promise<void>] | undefined> {
    for await (const request of this.getMatchingCompletedRequests(prompt)) {
      const remainingPrefixLength = prompt.prefix.length - request.prompt.prefix.length;
      const completionText = request.choice.completionText.substring(remainingPrefixLength);
      request.choice.telemetryData.measurements.foundOffset = remainingPrefixLength;
      return [{ ...request.choice, completionText }, request.allChoicesPromise];
    }
  }

  async *getMatchingCompletedRequests(prompt: Prompt): AsyncGenerator<CompletedRequest> {
    const requests = this.getMatchingRequests(prompt);
    const promiseMap = new Map<Request['id'], Promise<ErrorRequest | CompletedRequest>>(
      iterableMap(requests, (r) => [r.id, r.promise])
    );
    while (promiseMap.size > 0) {
      const request = await Promise.race(promiseMap.values());
      promiseMap.delete(request.id);
      if (
        request.state === RequestState.ERROR ||
        request.prompt.prefix.length + request.choice.completionText.length <= prompt.prefix.length
      ) {
        continue;
      }
      const remainingPrefix = prompt.prefix.substring(request.prompt.prefix.length);

      if (request.choice.completionText.startsWith(remainingPrefix)) {
        yield request;
      }
    }
  }
  *getMatchingRequests(prompt: Prompt): Generator<Exclude<Request, { state: RequestState.ERROR }>> {
    for (const request of this._requests.values()) {
      if (
        request.state !== RequestState.ERROR && // MARK: no overlap, always true?
        request.prompt.suffix === prompt.suffix &&
        prompt.prefix.startsWith(request.prompt.prefix) // MARK: matching may not be unique?
      ) {
        yield request;
      }
    }
  }
}

export { AsyncCompletionManager };
