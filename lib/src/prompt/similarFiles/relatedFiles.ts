import memoize from '@github/memoize';
import { URI } from 'vscode-uri';

import { type Context } from "../../context.ts";

import { LRUCacheMap } from "../../common/cache.ts";
import { telemetry, TelemetryData } from "../../telemetry.ts";
import { FileSystem } from "../../fileSystem.ts";
import { CopilotContentExclusionManager } from "../../contentExclusion/contentExclusionManager.ts";
import { shortCircuit } from "../../util/shortCircuit.ts";
import { Logger, LogLevel } from "../../logger.ts";

const relatedFilesLogger = new Logger(LogLevel.INFO, 'relatedFiles');

type DocumentInfo = {
  uri: string;
};

type Entry = {
  type: string;
  uris: string[];
};

const EmptyRelatedFilesResponse: { entries: Entry[] } = { entries: [] };
const EmptyRelatedFiles = new Map<string, Map<string, string>>();

type CacheEntry = {
  retryCount: number;
  timestamp: number;
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
    if (this._cacheTimestamps.has(key)) this._cacheTimestamps.delete(key);
    let entry = super.get(key);
    if (entry) super.delete(key);
  }
}

const lruCacheSize = 1000;
const defaultMaxRetryCount = 3;
const lruCache = new LRUExpirationCacheMap<string, Promise<Map<string, Map<string, string>>>>(lruCacheSize);

class RelatedFilesProviderFailure extends Error {
  constructor() {
    super('The provider failed providing the list of relatedFiles');
  }
}

abstract class RelatedFilesProvider {
  constructor(readonly context: Context) { }

  abstract getRelatedFileResponse(
    docInfo: DocumentInfo,
    wksFolder: unknown,
    telemetryData: TelemetryData
  ): Promise<{ entries: Entry[] }>;

  async getRelatedFiles(
    docInfo: DocumentInfo,
    wksFolder: unknown,
    telemetryData: TelemetryData
  ): Promise<Map<string, Map<string, string>> | null> {
    let response = await this.getRelatedFileResponse(docInfo, wksFolder, telemetryData);
    if (!response) return null;
    let relatedFiles = new Map<string, Map<string, string>>();
    for (let entry of response.entries) {
      let uriToContentMap = relatedFiles.get(entry.type);
      if (!uriToContentMap) {
        uriToContentMap = new Map();
        relatedFiles.set(entry.type, uriToContentMap);
      }
      for (let uriString of entry.uris) {
        try {
          const uri = URI.parse(uriString);
          uriString = uri.toString();
          relatedFilesLogger.debug(this.context, `Processing ${uriString} `);
          let content = await this.getFileContent(uri);
          if (!content || content.length === 0) {
            relatedFilesLogger.debug(this.context, `Skip ${uriString} due to empty content or loading issue.`);
            continue;
          }
          if (await this.isContentExcluded(uri, content)) {
            relatedFilesLogger.debug(this.context, `Skip ${uriString} due content exclusion.`);
            continue;
          }
          content = RelatedFilesProvider.dropBOM(content);
          uriToContentMap.set(uriString, content);
        } catch (e) {
          relatedFilesLogger.warn(this.context, e);
        }
      }
    }
    return relatedFiles;
  }

  async getFileContent(uri: URI): Promise<string | undefined> {
    try {
      return this.context.get(FileSystem).readFileString(uri);
    } catch (e) {
      relatedFilesLogger.debug(this.context, e);
    }
  }

  async isContentExcluded(uri: URI, content: string): Promise<boolean> {
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

async function getRelatedFiles(
  ctx: Context,
  docInfo: DocumentInfo,
  wksFolder: unknown,
  telemetryData: TelemetryData,
  relatedFilesProvider: RelatedFilesProvider
): Promise<Map<string, Map<string, string>>> {
  const startTime = Date.now();
  let result: Map<string, Map<string, string>> | null;
  try {
    result = await relatedFilesProvider.getRelatedFiles(docInfo, wksFolder, telemetryData);
  } catch (error) {
    relatedFilesLogger.exception(ctx, error, '.getRelatedFiles');
    result = null;
  }

  if (result === null) {
    if (lruCache.bumpRetryCount(docInfo.uri) >= defaultMaxRetryCount) {
      result = EmptyRelatedFiles;
    } else {
      result = null;
    }
  }

  const elapsedTime = Date.now() - startTime;
  relatedFilesLogger.debug(
    ctx,
    result !== null
      ? `Fetched ${[...result.values()].map((value) => value.size).reduce((total, current) => total + current, 0)} related files for '${docInfo.uri}' in ${elapsedTime} ms.`
      : `Failing fetching files for '${docInfo.uri}' in ${elapsedTime} ms.`
  );
  if (result === null) throw new RelatedFilesProviderFailure();
  return result;
}

let getRelatedFilesWithCacheAndTimeout = memoize(getRelatedFiles, {
  cache: lruCache,
  hash: (
    ctx: Context,
    docInfo: DocumentInfo,
    wksFolder: unknown,
    telemetryData: TelemetryData,
    symbolDefinitionProvider: RelatedFilesProvider
  ) => `${docInfo.uri} `,
});

getRelatedFilesWithCacheAndTimeout = shortCircuit(getRelatedFilesWithCacheAndTimeout, 200, EmptyRelatedFiles);

async function getRelatedFilesList(
  ctx: Context,
  docInfo: DocumentInfo,
  wksFolder: unknown,
  telemetryData: TelemetryData,
  forceComputation = false
): Promise<Map<string, Map<string, string>>> {
  let relatedFilesProvider = ctx.get(RelatedFilesProvider);
  let relatedFiles: Map<string, Map<string, string>>;
  try {
    relatedFiles = forceComputation
      ? await getRelatedFiles(ctx, docInfo, wksFolder, telemetryData, relatedFilesProvider)
      : await getRelatedFilesWithCacheAndTimeout(ctx, docInfo, wksFolder, telemetryData, relatedFilesProvider);
  } catch (error) {
    relatedFiles = EmptyRelatedFiles;
    if (error instanceof RelatedFilesProviderFailure) {
      await telemetry(ctx, 'getRelatedFilesList', telemetryData);
    }
  }
  return relatedFiles;
}

export {
  getRelatedFilesList,
  relatedFilesLogger,
  RelatedFilesProvider,
  EmptyRelatedFilesResponse,
  DocumentInfo,
  Entry,
};
