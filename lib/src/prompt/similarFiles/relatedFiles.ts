import memoize from '@github/memoize';

import { type Context } from '../../context.ts';

import { LRUCacheMap } from '../../common/cache.ts';
import { telemetry, TelemetryData } from '../../telemetry.ts';
import { FileSystem } from '../../fileSystem.ts';
import { CopilotContentExclusionManager } from '../../contentExclusion/contentExclusionManager.ts';
import { shortCircuit } from '../../util/shortCircuit.ts';
import { Logger, LogLevel } from '../../logger.ts';
import { DocumentUri } from 'vscode-languageserver-types';
import { LanguageId } from '../../types.ts';

const relatedFilesLogger = new Logger(LogLevel.INFO, 'relatedFiles');

type DocumentInfo = {
  uri: DocumentUri;
  languageId: LanguageId;
};

type Entry = {
  type: string;
  uris: DocumentUri[];
};

type CacheEntry = {
  retryCount: number;
  timestamp: number;
};

type Trait = { name: string; value: string };

type RelatedFilesResult = {
  entries: Map<string, Map<string, string>>;
  traits: Trait[];
};

async function getRelatedFiles(
  ctx: Context,
  docInfo: DocumentInfo,
  telemetryData: TelemetryData,
  relatedFilesProvider: RelatedFilesProvider
): Promise<RelatedFilesResult | null> {
  const startTime = Date.now();
  let result;
  try {
    result = await relatedFilesProvider.getRelatedFiles(docInfo, telemetryData);
  } catch (error) {
    relatedFilesLogger.exception(ctx, error, '.getRelatedFiles'), (result = null);
  }
  if (!result) {
    if (lruCache.bumpRetryCount(docInfo.uri) >= defaultMaxRetryCount) {
      result = EmptyRelatedFiles;
    } else {
      result = null;
    }
  }
  let elapsedTime = Date.now() - startTime;
  relatedFilesLogger.debug(
    ctx,
    result
      ? `Fetched ${[...result.entries.values()].map((value) => value.size).reduce((total, current) => total + current, 0)} related files for '${docInfo.uri}' in ${elapsedTime}ms.`
      : `Failing fecthing files for '${docInfo.uri}' in ${elapsedTime}ms.`
  );
  if (!result) throw new RelatedFilesProviderFailure();
  return result;
}

async function getRelatedFilesList(
  ctx: Context,
  docInfo: DocumentInfo,
  telemetryData: TelemetryData,
  forceComputation = false
): Promise<Map<string, Map<string, string>>> {
  const relatedFilesProvider = ctx.get(RelatedFilesProvider);
  let relatedFiles: RelatedFilesResult | null;
  try {
    relatedFiles = forceComputation
      ? await getRelatedFiles(ctx, docInfo, telemetryData, relatedFilesProvider)
      : await getRelatedFilesWithCacheAndTimeout(ctx, docInfo, telemetryData, relatedFilesProvider);
  } catch (error) {
    if (error instanceof RelatedFilesProviderFailure) {
      await telemetry(ctx, 'getRelatedFilesList', telemetryData);
    }
  }
  relatedFiles ??= EmptyRelatedFiles;
  ReportTraitsTelemetry(ctx, relatedFiles.traits, docInfo, telemetryData);
  relatedFilesLogger.debug(
    ctx,
    relatedFiles != null
      ? `Fetched following traits ${relatedFiles.traits.map((trait) => `{${trait.name} : ${trait.value}}`).join('')} for '${docInfo.uri}'`
      : `Failing fecthing traits for '${docInfo.uri}'.`
  );
  return relatedFiles.entries;
}

async function ReportTraitsTelemetry(
  ctx: Context,
  traits: Trait[],
  docInfo: DocumentInfo,
  telemetryData: TelemetryData
) {
  if (traits.length > 0) {
    const properties: Record<string, string> = {};
    properties.languageId = docInfo.languageId;
    for (let trait of traits) {
      let mappedTraitName = traitNamesForTelemetry.get(trait.name);
      mappedTraitName && (properties[mappedTraitName] = trait.value);
    }
    let telemetryDataExt = telemetryData.extendedBy(properties, {});
    await telemetry(ctx, 'related.traits', telemetryDataExt);
  }
}

const EmptyRelatedFilesResponse = { entries: [] as Entry[], traits: [] as Trait[] };
const EmptyRelatedFiles: RelatedFilesResult = {
  entries: new Map<string, Map<string, string>>(),
  traits: [] as Trait[],
};

class LRUExpirationCacheMap<K, V> extends LRUCacheMap<K, V> {
  private _cacheTimestamps = new Map<K, CacheEntry>();

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
const lruCache = new LRUExpirationCacheMap<string, Promise<RelatedFilesResult | null>>(lruCacheSize);

class RelatedFilesProviderFailure extends Error {
  constructor() {
    super('The provider failed providing the list of relatedFiles');
  }
}

abstract class RelatedFilesProvider {
  constructor(readonly context: Context) {}

  abstract getRelatedFilesResponse(
    docInfo: DocumentInfo,
    telemetryData: TelemetryData
  ): Promise<{ entries: Entry[]; traits?: Trait[] }>;

  async getRelatedFiles(docInfo: DocumentInfo, telemetryData: TelemetryData): Promise<RelatedFilesResult | null> {
    const response = await this.getRelatedFilesResponse(docInfo, telemetryData);
    if (!response) return null;
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
    docInfo: DocumentInfo,
    telemetryData: TelemetryData,
    symbolDefinitionProvider: RelatedFilesProvider
  ) => `${docInfo.uri} `,
});

getRelatedFilesWithCacheAndTimeout = shortCircuit(getRelatedFilesWithCacheAndTimeout, 200, EmptyRelatedFiles);
const traitNamesForTelemetry = new Map([
  ['TargetFrameworks', 'targetFrameworks'],
  ['LanguageVersion', 'languageVersion'],
]);

export {
  getRelatedFilesList,
  relatedFilesLogger,
  RelatedFilesProvider,
  EmptyRelatedFilesResponse,
  DocumentInfo,
  Entry,
};
