import { performance } from 'perf_hooks';
import type { SnippetContext, Snippet, SnippetsResult, SnippetsError } from '../types.ts';

import { Methods, WorkerProxy } from '../workerProxy.ts';

import { ProviderError, TIMEOUT_MS } from '../orchestrator.ts';

class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

abstract class SnippetProvider {
  protected api: Methods;
  abstract readonly type: string;

  constructor(workerProxy: WorkerProxy) {
    this.api = workerProxy.api;
  }

  async getSnippets(context: SnippetContext, signal: AbortSignal): Promise<SnippetsResult> {
    if (signal.aborted) {
      throw new ProviderError(this.type, new ProviderTimeoutError('provider aborted'));
    }
    const handleAbort = () => {
      throw new ProviderError(this.type, new ProviderTimeoutError(`max runtime exceeded: ${TIMEOUT_MS} ms`));
    };

    signal.addEventListener('abort', handleAbort, { once: true });

    const startTime = performance.now();

    try {
      const snippets = await this.buildSnippets(context);
      const endTime = performance.now();
      return { snippets: snippets, providerType: this.type, runtime: endTime - startTime };
    } catch (error) {
      throw new ProviderError(this.type, error);
    } finally {
      // EDITED
      signal.removeEventListener('abort', handleAbort);
    }
  }

  abstract buildSnippets(context: SnippetContext): Promise<Snippet[]>;
}

export { SnippetContext, SnippetsResult, SnippetsError, ProviderTimeoutError, SnippetProvider };
