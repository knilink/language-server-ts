import { LRUCacheMap } from '../common/cache.ts';
import { APIChoice } from '../openai/openai.ts';

type CacheEntry = {
  multiline: boolean;
  choices: APIChoice[];
};

class CompletionsCache {
  private _cache: LRUCacheMap<string, CacheEntry>;

  constructor() {
    this._cache = new LRUCacheMap(100);
  }

  get(promptKey: string): CacheEntry | undefined {
    return this._cache.get(promptKey);
  }

  // ./ghostText.ts
  set(promptKey: string, contents: CacheEntry): void {
    this._cache.set(promptKey, contents);
  }

  clear(): void {
    this._cache.clear();
  }
}

export { CompletionsCache };
