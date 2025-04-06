import type { DocumentUri, Position } from 'vscode-languageserver-types';
import type { CancellationToken } from 'vscode-languageserver-protocol';
import type { LanguageId } from '../types.ts';
import type { Context } from '../context.ts';
import type { TelemetryData, TelemetryWithExp } from '../telemetry.ts';
import type {
  ContextItem,
  RegistrationContextProviderType,
  ContextItemResolution,
  SupportedContextItemTypeUnion,
} from './contextProviders/contextItemSchemas.ts';
import type { LspClientContextProvider } from '../../../agent/src/contextProvider.ts';

import { setTimeout } from 'timers/promises';
import { CancellationTokenSource } from 'vscode-languageserver-protocol';
import { fillInCppActiveExperiments } from './contextProviderRegistryCpp.ts';
import { ContextProviderStatistics } from './contextProviderStatistics.ts';
import { isCancellationError } from './contextProviders/fallbackContextProvider/indexing/util.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { ConfigKey, getConfig } from '../config.ts';
import { Features } from '../experiments/features.ts';
import { logger } from '../logger.ts';
import { isDebugEnabled, isRunningInSimulation } from '../testing/runtimeMode.ts';
import { v4 as uuidv4 } from 'uuid';

interface ContextItemHandleRequest {
  timeBudget: number;
  previousUsageStatistics?: { usage: string; resolution: ContextItemResolution };
  completionId?: string;
  documentContext: DocumentContext;
  activeExperiments: Map<string, unknown>;
  data: unknown;
}

interface DocumentContext {
  uri: DocumentUri;
  languageId: LanguageId;
  version: number;
  offset: number;
  position: Position;
}

type Matcher = (
  ctx: Context,
  selector: RegistrationContextProviderType['selector'],
  documentContext: DocumentContext
) => Promise<number>;

function nullTimeout(timeoutMs: number): Promise<null> {
  return timeoutMs > 0 ? setTimeout(timeoutMs, null) : new Promise(() => {});
}

async function extractDataFromPendingContextItem(
  ctx: Context,
  resolvedContextItem:
    | AsyncIterable<SupportedContextItemTypeUnion>
    | Promise<SupportedContextItemTypeUnion[] | SupportedContextItemTypeUnion>,
  request: ContextItemHandleRequest,
  provider: LspClientContextProvider,
  providerCancellationTokenSource: CancellationTokenSource
): Promise<[SupportedContextItemTypeUnion[], ContextItemResolution]> {
  let result: SupportedContextItemTypeUnion[];
  let resolution: ContextItemResolution;

  if (resolvedContextItem instanceof Promise) {
    [result, resolution] = await handlePromiseContextItem(
      ctx,
      resolvedContextItem,
      request,
      provider,
      providerCancellationTokenSource
    );
  } else {
    [result, resolution] = await handleAsyncIteratorContextItem(
      ctx,
      resolvedContextItem,
      request,
      provider,
      providerCancellationTokenSource
    );
  }

  return [result, resolution];
}

async function handlePromiseContextItem(
  ctx: Context,
  resolvedContextItem: Promise<SupportedContextItemTypeUnion[] | SupportedContextItemTypeUnion>,
  request: ContextItemHandleRequest,
  provider: LspClientContextProvider,
  providerCancellationTokenSource: CancellationTokenSource
): Promise<[SupportedContextItemTypeUnion[], ContextItemResolution]> {
  const result: SupportedContextItemTypeUnion[] = [];
  let resolution: ContextItemResolution;
  const timeoutPromise = nullTimeout(request.timeBudget);
  try {
    const contextItem = await Promise.race([resolvedContextItem, timeoutPromise]);

    if (contextItem === null) {
      resolution = 'none';
      providerCancellationTokenSource.cancel();
      logger.info(ctx, `Context provider ${provider.id} exceeded time budget of ${request.timeBudget}ms`);
    } else {
      resolution = 'full';

      if (Array.isArray(contextItem)) {
        result.push(...contextItem);
      } else {
        result.push(contextItem);
      }
    }
  } catch (err) {
    if (!isCancellationError(err)) {
      logger.error(ctx, `Error resolving context from ${provider.id}: `, err);
    }

    providerCancellationTokenSource.cancel();
    return [[], 'error'];
  }
  return [result, resolution];
}

async function handleAsyncIteratorContextItem(
  ctx: Context,
  resolvedContextItem: AsyncIterable<SupportedContextItemTypeUnion>,
  request: ContextItemHandleRequest,
  provider: LspClientContextProvider,
  providerCancellationTokenSource: CancellationTokenSource
): Promise<[SupportedContextItemTypeUnion[], ContextItemResolution]> {
  const result: SupportedContextItemTypeUnion[] = [];
  let resolution: ContextItemResolution;
  const timeoutPromise = nullTimeout(request.timeBudget);
  const collectPromise = (async () => {
    for await (const item of resolvedContextItem) result.push(item);
    return result;
  })();
  try {
    if ((await Promise.race([collectPromise, timeoutPromise])) === null) {
      resolution = result.length > 0 ? 'partial' : 'none';
      providerCancellationTokenSource.cancel();
      logger.info(ctx, `Context provider ${provider.id} exceeded time budget of ${request.timeBudget}ms`);
    } else {
      resolution = 'full';
    }
  } catch (err) {
    if (!isCancellationError(err)) {
      logger.error(ctx, `Error resolving context from ${provider.id}: `, err);
    }

    providerCancellationTokenSource.cancel();
    return [[], 'error'];
  }
  return [result, resolution];
}

function getContextProviderRegistry(ctx: Context, match: Matcher) {
  return new CachedContextProviderRegistry(new CoreContextProviderRegistry(ctx, match));
}

function telemetrizeContextItems(ctx: Context, contextItems: ContextItem[], telemetryData: TelemetryWithExp) {
  const contextProviderStatistics = ctx.get(ContextProviderStatistics);

  const contextProviderTelemetry = contextItems.map((d) => {
    const { providerId, resolution, resolutionTimeMs, matchScore, data } = d;
    let usage = contextProviderStatistics.get(providerId)?.usage ?? 'none';

    if (matchScore <= 0) {
      usage = 'none';
    }

    return { providerId, resolution, resolutionTimeMs, usage, matched: matchScore > 0, numResolvedItems: data.length };
  });

  telemetryData.properties.contextProviders = JSON.stringify(contextProviderTelemetry);
}

function extractCompletionId(telemetryData: TelemetryData) {
  return telemetryData.properties.headerRequestId;
}

function addIdToContextItem(contextItem: SupportedContextItemTypeUnion): SupportedContextItemTypeUnion {
  return { ...contextItem, id: contextItem.id ?? uuidv4() };
}

function getExpContextProviders(ctx: Context, telemetryData: TelemetryWithExp) {
  if (isDebugEnabled(ctx)) {
    return ['*'];
  }
  const expContextProviders = ctx.get(Features).contextProviders(telemetryData);
  const configContextProviders = getConfig(ctx, ConfigKey.ContextProviders) ?? [];
  return (expContextProviders.length === 1 && expContextProviders[0] === '*') ||
    (configContextProviders.length === 1 && configContextProviders[0] === '*')
    ? ['*']
    : Array.from(new Set([...expContextProviders, ...configContextProviders]));
}

function useContextProviderAPI(ctx: Context, telemetryData: TelemetryWithExp) {
  return getExpContextProviders(ctx, telemetryData).length > 0;
}

abstract class ContextProviderRegistry {
  abstract readonly providers: RegistrationContextProviderType[];
  abstract registerContextProvider(provider: RegistrationContextProviderType): void;
  abstract unregisterContextProvider(providerId: string): void;
  abstract resolveAllProviders(
    documentContext: DocumentContext,
    telemetryData: TelemetryWithExp,
    completionToken: CancellationToken | undefined,
    data: unknown
  ): Promise<ContextItem[]>;
}

class CoreContextProviderRegistry extends ContextProviderRegistry {
  _providers: LspClientContextProvider[] = [];

  constructor(
    readonly ctx: Context,
    readonly match: Matcher
  ) {
    super();
  }

  registerContextProvider(provider: LspClientContextProvider) {
    if (provider.id.includes(',') || provider.id.includes('*')) {
      throw new Error(`A context provider id cannot contain a comma or an asterisk. The id ${provider.id} is invalid.`);
    }
    if (this._providers.find((p) => p.id === provider.id)) {
      throw new Error(`A context provider with id ${provider.id} has already been registered`);
    }
    this._providers.push(provider);
  }

  unregisterContextProvider(providerId: string) {
    this._providers = this._providers.filter((p) => p.id !== providerId);
  }

  get providers() {
    return this._providers.slice();
  }

  async resolveAllProviders(
    documentContext: DocumentContext,
    telemetryData: TelemetryWithExp,
    completionCancellationToken: CancellationToken,
    data: unknown
  ) {
    if (completionCancellationToken?.isCancellationRequested) {
      logger.debug(this.ctx, 'Resolving context providers cancelled');
      return [];
    }
    const activeExperiments = new Map<string, unknown>();
    fillInCppActiveExperiments(this.ctx, activeExperiments, telemetryData);
    const results: ContextItem[] = [];
    if (this._providers.length === 0) {
      return results;
    }
    const providersWithMatchScore = await this.matchProviders(documentContext, telemetryData);
    const matchedProviders = providersWithMatchScore.filter((p) => p[1] > 0);
    providersWithMatchScore
      .filter((p) => p[1] <= 0)
      .forEach(([provider, score]) => {
        const contextItem: ContextItem = {
          providerId: provider.id,
          matchScore: score,
          resolution: 'none',
          resolutionTimeMs: 0,
          data: [],
        };
        results.push(contextItem);
      });
    if (matchedProviders.length === 0) {
      return results;
    }
    if (completionCancellationToken?.isCancellationRequested) {
      logger.debug(this.ctx, 'Resolving context providers cancelled');
      return [];
    }
    const timeBudget =
      isDebugEnabled(this.ctx) && !isRunningInSimulation(this.ctx)
        ? 0
        : getConfig(this.ctx, ConfigKey.ContextProviderTimeBudget);
    const budgetPerProvider = matchedProviders.length > 0 ? timeBudget / matchedProviders.length : timeBudget;
    for (const [provider, score] of matchedProviders) {
      const request: ContextItemHandleRequest = {
        completionId: extractCompletionId(telemetryData), // MARK read from telemetry, really?
        documentContext,
        activeExperiments,
        timeBudget: budgetPerProvider,
        data,
      };
      const stats = this.ctx.get(ContextProviderStatistics).pop(provider.id);

      if (stats) {
        request.previousUsageStatistics = stats;
      }

      const providerCancellationTokenSource = new CancellationTokenSource();

      completionCancellationToken?.onCancellationRequested((_) => {
        providerCancellationTokenSource.cancel();
      });

      const start = performance.now();
      const pendingContextItem = provider.resolver.resolve(request, providerCancellationTokenSource.token);
      const [resolvedContextItemsData, resolution] = await extractDataFromPendingContextItem(
        this.ctx,
        pendingContextItem,
        request,
        provider,
        providerCancellationTokenSource
      );
      const end = performance.now();
      this.ctx.get(ContextProviderStatistics).setLastResolution(provider.id, resolution);
      const contextItem: ContextItem = {
        providerId: provider.id,
        matchScore: score,
        resolution,
        resolutionTimeMs: end - start,
        data: resolvedContextItemsData.map(addIdToContextItem),
      };
      results.push(contextItem);
    }
    return results.sort((a, b) => b.matchScore - a.matchScore);
  }

  async matchProviders(
    documentContext: DocumentContext,
    telemetryData: TelemetryWithExp
  ): Promise<[LspClientContextProvider, number][]> {
    const activeContextProviders = getExpContextProviders(this.ctx, telemetryData);
    const enableAllProviders = activeContextProviders.length === 1 && activeContextProviders[0] === '*';
    return await Promise.all(
      this._providers.map(async (provider) => {
        if (!enableAllProviders && !activeContextProviders.includes(provider.id)) {
          return [provider, 0];
        }
        const matchScore = await this.match(this.ctx, provider.selector, documentContext);
        return [provider, matchScore];
      })
    );
  }
}

class CachedContextProviderRegistry extends ContextProviderRegistry {
  readonly _cachedContextItems = new LRUCacheMap<string, ContextItem[]>(5);
  constructor(readonly delegate: ContextProviderRegistry) {
    super();
  }

  registerContextProvider(provider: RegistrationContextProviderType) {
    this.delegate.registerContextProvider(provider);
  }
  unregisterContextProvider(providerId: string) {
    this.delegate.unregisterContextProvider(providerId);
  }
  get providers() {
    return this.delegate.providers;
  }

  async resolveAllProviders(
    documentContext: DocumentContext,
    telemetryData: TelemetryWithExp,
    completionToken: CancellationToken,
    data: unknown
  ) {
    const completionId = extractCompletionId(telemetryData);
    const cachedItems = this._cachedContextItems.get(completionId);
    if (completionId && cachedItems && cachedItems.length > 0) {
      return cachedItems;
    }
    const contextItems = await this.delegate.resolveAllProviders(documentContext, telemetryData, completionToken, data);

    if (contextItems.length > 0 && completionId) {
      this._cachedContextItems.set(completionId, contextItems);
    }

    return contextItems;
  }
}

export { ContextProviderRegistry, getContextProviderRegistry, telemetrizeContextItems, useContextProviderAPI };

export type { DocumentContext };
