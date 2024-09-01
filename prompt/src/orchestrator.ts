import { Snippet } from './types.ts';
import { TooltipSignatureSnippetProvider } from './snippetProviders/tooltipSignature.ts';
import { SnippetProvider } from './snippetProviders/snippetProvider.ts';
import { PathSnippetProvider } from './snippetProviders/path.ts';
import { WorkerProxy, workerProxy } from './workerProxy.ts';
import { LanguageSnippetProvider } from './snippetProviders/language.ts';
import {
  ProviderTimeoutError,
  SnippetContext,
  SnippetsResult,
  SnippetsError,
} from './snippetProviders/snippetProvider.ts';
import { SimilarFilesProvider } from './snippetProviders/similarFiles.ts';

type ResolvedResult = { status: 'fulfilled'; value: SnippetsResult };
type RejectedResult = { status: 'rejected'; reason: SnippetsError };
type PromiseResult = ResolvedResult | RejectedResult;

function isResolvedResult(result: PromiseResult): result is ResolvedResult {
  return result.status === 'fulfilled';
}

function isRejectedResult(result: PromiseResult): result is RejectedResult {
  return result.status === 'rejected';
}

function providersSnippets(results: PromiseResult[]): Snippet[] {
  return results.filter(isResolvedResult).flatMap((r) => r.value.snippets);
}

function providersErrors(results: PromiseResult[]): { error: unknown }[] {
  return results.filter(isRejectedResult).flatMap((r) => [r.reason]);
}

function providersPerformance(results: PromiseResult[]) {
  const runtimes: Record<string, number> = {};
  const timeouts: Record<string, boolean> = {};
  results.forEach((result) => {
    if (isResolvedResult(result)) {
      runtimes[result.value.providerType] = Math.round(result.value.runtime);
      timeouts[result.value.providerType] = false;
    } else if (result.reason.error instanceof ProviderTimeoutError) {
      timeouts[result.reason.providerType] = true;
      runtimes[result.reason.providerType] = 0;
    }
  });
  return { runtimes, timeouts };
}

async function allSettledBackup(promises: Promise<SnippetsResult>[]): Promise<(ResolvedResult | RejectedResult)[]> {
  return await Promise.all(promises.map((p) => p.then(createPromiseResolvedResult, createPromiseRejectedResult)));
}

function createPromiseResolvedResult(value: {
  snippets: Snippet[];
  providerType: string;
  runtime: number;
}): ResolvedResult {
  return { status: 'fulfilled', value };
}

function createPromiseRejectedResult(reason: SnippetsError): RejectedResult {
  return { status: 'rejected', reason };
}

const TIMEOUT_MS = 300;
const defaultProviders: (new (workerProxy: WorkerProxy) => SnippetProvider)[] = [
  LanguageSnippetProvider,
  PathSnippetProvider,
  SimilarFilesProvider,
  TooltipSignatureSnippetProvider,
];

class SnippetOrchestrator {
  private providers: SnippetProvider[];

  constructor(providers: (new (workerProxy: WorkerProxy) => SnippetProvider)[] = defaultProviders) {
    this.providers = providers.map((provider) => new provider(workerProxy));
  }

  startThreading() {
    workerProxy.startThreading();
  }

  stopThreading() {
    workerProxy.stopThreading();
  }

  async getSnippets(context: SnippetContext): Promise<(ResolvedResult | RejectedResult)[]> {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const providerSnippets = this.providers.map((provider) => provider.getSnippets(context, signal));
    return Promise.allSettled ? Promise.allSettled(providerSnippets) : allSettledBackup(providerSnippets);
  }
}

export {
  SnippetOrchestrator,
  TIMEOUT_MS,
  providersSnippets,
  providersErrors,
  providersPerformance,
  isResolvedResult,
  isRejectedResult,
};
