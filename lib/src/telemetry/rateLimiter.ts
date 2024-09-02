import { LRUCacheMap } from '../common/cache.ts';

class ExceptionRateLimiter {
  perMinute: number;
  cache: LRUCacheMap<string, number[]>;

  constructor(perMinute: number = 5) {
    this.perMinute = perMinute;
    this.cache = new LRUCacheMap();
  }

  isThrottled(key: string): boolean {
    const now = Date.now();
    let recent = this.cache.get(key) || new Array(this.perMinute).fill(0);
    if (now - recent[0] < 60_000) {
      return true;
    } else {
      recent.push(now);
      recent.shift();
      this.cache.set(key, recent);
      return false;
    }
  }
}

export { ExceptionRateLimiter };
