import { type TurnContext } from '../../turnContext.ts';

import { NetworkConfiguration } from '../../../networkConfiguration.ts';
import { Fetcher } from '../../../networking.ts';
import { tryGetGitHubNWO, type RepoInfo } from '../../../prompt/repository.ts';
import { LRUCacheMap } from '../../../common/cache.ts';

type CacheEntry = {
  status: boolean;
  timestamp: number;
};

class BlackbirdIndexingStatus {
  private _cache = new LRUCacheMap<string, CacheEntry>(100);

  async queryIndexingStatus(turnContext: TurnContext, repoNwo: string, githubToken: string): Promise<boolean> {
    const ctx = turnContext.ctx;
    const indexingStatusUrl = ctx.get(NetworkConfiguration).getBlackbirdIndexingStatusUrl();
    if (!githubToken) return false;

    const url = new URL(indexingStatusUrl);
    url.searchParams.set('nwo', repoNwo);

    const headers = { Authorization: `token ${githubToken}` };
    const response = await ctx.get(Fetcher).fetch(url.href, { method: 'GET', headers });

    if (!response.ok) return false;

    const json: any = await response.json();
    return json.docs_status === 'indexed' || json.code_status === 'indexed';
  }

  isValid(cacheEntry: CacheEntry | undefined): cacheEntry is CacheEntry {
    return cacheEntry !== undefined && Date.now() - cacheEntry.timestamp < 30 * 60_000;
  }

  async isRepoIndexed(
    turnContext: TurnContext,
    repoInfo: RepoInfo,
    githubToken: string,
    forceCheck = false
  ): Promise<boolean> {
    const repoNwo = tryGetGitHubNWO(repoInfo);
    if (!repoNwo) return false;

    let cached = this._cache.get(repoNwo);
    if (!forceCheck && this.isValid(cached)) return cached.status;

    const status = await this.queryIndexingStatus(turnContext, repoNwo, githubToken);
    this._cache.set(repoNwo, { status: status, timestamp: Date.now() });

    return status;
  }

  get cache(): LRUCacheMap<string, CacheEntry> {
    return this._cache;
  }
}

export { BlackbirdIndexingStatus };
