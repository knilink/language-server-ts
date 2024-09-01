import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCacheMap } from "./cache.ts"; // Update with the correct path to your LRUCacheMap file

describe('LRUCacheMap', () => {
  let lru: LRUCacheMap<string, number>;

  beforeEach(() => {
    lru = new LRUCacheMap(2); // Initialize a new instance of LRUCacheMap with size 2
  });

  it('should set and get values correctly', () => {
    lru.set('a', 1);
    expect(lru.get('a')).toBe(1);

    lru.set('b', 2);
    expect(lru.get('b')).toBe(2);
  });

  it('should evict the least recently used item', () => {
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3); // This should evict 'a'

    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBe(2);
    expect(lru.get('c')).toBe(3);
  });

  it('should update the order when accessing an item', () => {
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a'); // Access 'a' to change its order
    lru.set('c', 3); // This should evict 'b' because it is the least recently used now

    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
  });

  it('should clear all items', () => {
    lru.set('a', 1);
    lru.set('b', 2);
    lru.clear();

    expect(lru.size).toBe(0);
    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBeUndefined();
  });
});
