import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../context.ts';
import type { Entry, Trait } from '../../../../types/src/index.ts';

import memoize from '@github/memoize';
import { LRUCacheMap } from '../../common/cache.ts';
import { telemetry, TelemetryData } from '../../telemetry.ts';
import { FileSystem } from '../../fileSystem.ts';
import { CopilotContentExclusionManager } from '../../contentExclusion/contentExclusionManager.ts';
import { shortCircuit } from '../../util/shortCircuit.ts';
import { Logger } from '../../logger.ts';
import { DocumentUri } from 'vscode-languageserver-types';
import { LanguageId } from '../../types.ts';

const relatedFilesLogger = new Logger('relatedFiles');

type CacheEntry = {
  retryCount: number;
  timestamp: number;
};

async function getRelatedFiles(
  ctx: Context,
  docInfo: { uri: DocumentUri; clientLanguageId: string; data: unknown },
  telemetryData: TelemetryData,
  cancellationToken: CancellationToken | undefined,
  relatedFilesProvider: RelatedFilesProvider
): Promise<RelatedFilesProvider.RelatedFilesResult | null> {
  const startTime = Date.now();
  let result;
  try {
    result = await relatedFilesProvider.getRelatedFiles(docInfo, telemetryData, cancellationToken);
  } catch (error) {
    relatedFilesLogger.exception(ctx, error, '.getRelatedFiles'), (result = null);
  }
  if (result === null) {
    if (lruCache.bumpRetryCount(docInfo.uri) >= defaultMaxRetryCount) {
      result = EmptyRelatedFiles;
    } else {
      result = null;
    }
  }
  let elapsedTime = Date.now() - startTime;
  relatedFilesLogger.debug(
    ctx,
    result !== null
      ? `Fetched ${[...result.entries.values()].map((value) => value.size).reduce((total, current) => total + current, 0)} related files for '${docInfo.uri}' in ${elapsedTime}ms.`
      : `Failing fetching files for '${docInfo.uri}' in ${elapsedTime}ms.`
  );
  if (result === null) throw new RelatedFilesProviderFailure();
  return result;
}

async function getRelatedFilesAndTraits(
  ctx: Context,
  doc: { uri: DocumentUri; clientLanguageId: string; detectedLanguageId: LanguageId },
  telemetryData: TelemetryData,
  cancellationToken: CancellationToken | undefined,
  data: unknown,
  forceComputation = false
): Promise<RelatedFilesProvider.RelatedFilesResult> {
  const relatedFilesProvider = ctx.get(RelatedFilesProvider);
  let relatedFiles: RelatedFilesProvider.RelatedFilesResult | null;
  try {
    const docInfo = { uri: doc.uri, clientLanguageId: doc.clientLanguageId, data };
    relatedFiles = forceComputation
      ? await getRelatedFiles(ctx, docInfo, telemetryData, cancellationToken, relatedFilesProvider)
      : await getRelatedFilesWithCacheAndTimeout(ctx, docInfo, telemetryData, cancellationToken, relatedFilesProvider);
  } catch (error) {
    if (error instanceof RelatedFilesProviderFailure) {
      telemetry(ctx, 'getRelatedFilesList', telemetryData);
    }
  }
  relatedFiles ??= EmptyRelatedFiles;
  ReportTraitsTelemetry(ctx, relatedFiles.traits, doc, telemetryData);
  relatedFilesLogger.debug(
    ctx,
    relatedFiles != null
      ? `Fetched following traits ${relatedFiles.traits.map((trait) => `{${trait.name} : ${trait.value}}`).join('')} for '${doc.uri}'`
      : `Failing fecthing traits for '${doc.uri}'.`
  );
  return relatedFiles;
}

function ReportTraitsTelemetry(
  ctx: Context,
  traits: Trait[],
  docInfo: { detectedLanguageId: LanguageId; clientLanguageId: string },
  telemetryData: TelemetryData
) {
  if (traits.length > 0) {
    const properties: Record<string, string> = {};
    properties.detectedLanguageId = docInfo.detectedLanguageId;
    properties.languageId = docInfo.clientLanguageId;
    for (const trait of traits) {
      const mappedTraitName = traitNamesForTelemetry.get(trait.name);
      if (mappedTraitName) properties[mappedTraitName] = trait.value;
    }
    const telemetryDataExt = telemetryData.extendedBy(properties, {});
    telemetry(ctx, 'related.traits', telemetryDataExt);
  }
}

const EmptyRelatedFilesResponse = { entries: [] as Entry[], traits: [] as Trait[] };
const EmptyRelatedFiles: RelatedFilesProvider.RelatedFilesResult = {
  entries: new Map<string, Map<string, string>>(),
  traits: [] as Trait[],
};

class LRUExpirationCacheMap<K, V> extends LRUCacheMap<K, V> {
  _cacheTimestamps = new Map<K, CacheEntry>();

  constructor(
    size: number,
    readonly defaultEvictionTimeMs = 2 * 60 * 1e3
  ) {
    super(size);
  }

  bumpRetryCount(key: K): number {
    let ts = this._cacheTimestamps.get(key);
    if (ts) {
      ts.retryCount++;
      return ts.retryCount;
    } else {
      this._cacheTimestamps.set(key, { timestamp: Date.now(), retryCount: 0 });
      return 0;
    }
  }

  has(key: K) {
    if (this.isValid(key)) return super.has(key);
    this.deleteExpiredEntry(key);
    return false;
  }

  get(key: K): V | undefined {
    let entry = super.get(key);
    if (this.isValid(key)) return entry;
    this.deleteExpiredEntry(key);
  }

  set(key: K, value: V): LRUCacheMap<K, V> {
    let ret = super.set(key, value);
    if (!this.isValid(key)) {
      this._cacheTimestamps.set(key, { timestamp: Date.now(), retryCount: 0 });
    }
    return ret;
  }

  clear(): void {
    super.clear();
    this._cacheTimestamps.clear();
  }

  isValid(key: K): boolean {
    const ts = this._cacheTimestamps.get(key);
    return ts !== undefined && Date.now() - ts.timestamp < this.defaultEvictionTimeMs;
  }

  deleteExpiredEntry(key: K): void {
    if (this._cacheTimestamps.has(key)) {
      this._cacheTimestamps.delete(key);
    }
    super.deleteKey(key);
  }
}

const lruCacheSize = 1000;
const defaultMaxRetryCount = 3;
const lruCache = new LRUExpirationCacheMap<string, Promise<RelatedFilesProvider.RelatedFilesResult | null>>(
  lruCacheSize
);

class RelatedFilesProviderFailure extends Error {
  constructor() {
    super('The provider failed providing the list of relatedFiles');
  }
}

namespace RelatedFilesProvider {
  export type RelatedFilesResponse = { entries: Entry[]; traits: Trait[] };
  export type RelatedFilesResult = {
    entries: Map<string, Map<string, string>>;
    traits: Trait[];
  };
}

abstract class RelatedFilesProvider {
  constructor(readonly context: Context) {}

  abstract getRelatedFilesResponse(
    docInfo: { uri: DocumentUri; clientLanguageId: string; data: unknown },
    telemetryData: TelemetryData,
    cancellationToken: CancellationToken | undefined
  ): Promise<RelatedFilesProvider.RelatedFilesResponse | null>;

  async getRelatedFiles(
    docInfo: { uri: DocumentUri; clientLanguageId: string; data: unknown },
    telemetryData: TelemetryData,
    cancellationToken: CancellationToken | undefined
  ): Promise<RelatedFilesProvider.RelatedFilesResult | null> {
    const response = await this.getRelatedFilesResponse(docInfo, telemetryData, cancellationToken);
    if (response === null) {
      return null;
    }
    const result = { entries: new Map(), traits: response.traits ?? [] };
    for (let entry of response.entries) {
      let uriToContentMap = result.entries.get(entry.type);
      if (!uriToContentMap) {
        uriToContentMap = new Map();
        result.entries.set(entry.type, uriToContentMap);
      }

      for (const uri of entry.uris) {
        try {
          relatedFilesLogger.debug(this.context, `Processing ${uri}`);

          let content = await this.getFileContent(uri);
          if (!content || content.length === 0) {
            relatedFilesLogger.debug(this.context, `Skip ${uri} due to empty content or loading issue.`);
            continue;
          }
          if (await this.isContentExcluded(uri, content)) {
            relatedFilesLogger.debug(this.context, `Skip ${uri} due content exclusion.`);
            continue;
          }
          content = RelatedFilesProvider.dropBOM(content);
          uriToContentMap.set(uri, content);
        } catch (e) {
          relatedFilesLogger.warn(this.context, e);
        }
      }
    }
    return result;
  }

  async getFileContent(uri: DocumentUri): Promise<string | undefined> {
    try {
      return this.context.get(FileSystem).readFileString(uri);
    } catch (e) {
      relatedFilesLogger.debug(this.context, e);
    }
  }

  async isContentExcluded(uri: DocumentUri, content: string): Promise<boolean> {
    try {
      return (await this.context.get(CopilotContentExclusionManager).evaluate(uri, content)).isBlocked;
    } catch (e) {
      relatedFilesLogger.exception(this.context, e, 'isContentExcluded');
    }
    return true;
  }

  static dropBOM(content: string): string {
    return content.charCodeAt(0) === 65279 ? content.slice(1) : content;
  }
}

let getRelatedFilesWithCacheAndTimeout = memoize(getRelatedFiles, {
  cache: lruCache,
  hash: (
    ctx: Context,
    docInfo: { uri: DocumentUri; clientLanguageId: string; data: unknown },
    telemetryData: TelemetryData,
    cancellationToken: CancellationToken | undefined,
    symbolDefinitionProvider: RelatedFilesProvider
  ) => `${docInfo.uri} `,
});

getRelatedFilesWithCacheAndTimeout = shortCircuit(getRelatedFilesWithCacheAndTimeout, 200, EmptyRelatedFiles);
const traitNamesForTelemetry = new Map([
  ['TargetFrameworks', 'targetFrameworks'],
  ['LanguageVersion', 'languageVersion'],
]);

export { EmptyRelatedFilesResponse, RelatedFilesProvider, getRelatedFilesAndTraits, relatedFilesLogger, Entry, Trait };
