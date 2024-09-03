import { performance } from 'perf_hooks';
import type { SnippetContext, Snippet, SnippetsResult, SnippetsError } from '../types.ts';

import { Methods, WorkerProxy } from '../workerProxy.ts';

// import { TIMEOUT_MS } from "../orchestrator.ts";
const TIMEOUT_MS = 300; // MARK breaking circular deps, `TIMEOUT_MS` here is for generating message only

class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

abstract class SnippetProvider {
  protected api: Methods;
  abstract type: string;

  constructor(workerProxy: WorkerProxy) {
    this.api = workerProxy.api;
  }

  async getSnippets(context: SnippetContext, signal: AbortSignal): Promise<SnippetsResult> {
    if (signal.aborted) {
      throw { error: new ProviderTimeoutError('provider aborted'), providerType: this.type };
    }
    const handleAbort = () => {
      throw {
        error: new ProviderTimeoutError(`max runtime exceeded: ${TIMEOUT_MS} ms`),
        providerType: this.type,
      };
    };

    signal.addEventListener('abort', handleAbort, { once: true });

    const startTime = performance.now();

    try {
      const snippets = await this.buildSnippets(context);
      const endTime = performance.now();
      return { snippets: snippets, providerType: this.type, runtime: endTime - startTime };
    } catch (error) {
      throw { error, providerType: this.type };
    } finally {
      // EDITED
      signal.removeEventListener('abort', handleAbort);
    }
  }

  abstract buildSnippets(context: SnippetContext): Promise<Snippet[]>;
}

export { SnippetContext, SnippetsResult, SnippetsError, ProviderTimeoutError, SnippetProvider };
