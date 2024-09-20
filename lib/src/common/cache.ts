import CryptoJS from 'crypto-js';

interface Prompt {
  prefix: string;
  suffix: string;
}

export function keyForPrompt(prompt: Prompt): string {
  const combinedString = prompt.prefix + prompt.suffix;
  const utf16Encoded = CryptoJS.enc.Utf16.parse(combinedString);
  return CryptoJS.SHA256(utf16Encoded).toString();
}

export class LRUCacheMap<K, V> {
  private valueMap: Map<K, V>;
  private lruKeys: K[];
  private sizeLimit: number;

  constructor(size = 10) {
    this.valueMap = new Map();
    this.lruKeys = [];
    this.sizeLimit = size;
  }

  set(key: K, value: V): LRUCacheMap<K, V> {
    let maybeKeyToDelete: K | undefined;
    if (this.valueMap.has(key)) {
      maybeKeyToDelete = key;
    } else if (this.lruKeys.length >= this.sizeLimit) {
      maybeKeyToDelete = this.lruKeys[0];
    }

    if (maybeKeyToDelete !== undefined) {
      this.delete(maybeKeyToDelete);
    }

    this.valueMap.set(key, value);
    this.touchKeyInLRU(key);
    return this;
  }

  get(key: K): V | undefined {
    if (this.valueMap.has(key)) {
      const entry = this.valueMap.get(key);
      this.touchKeyInLRU(key);
      return entry;
    }
    return undefined;
  }

  delete(key: K): boolean {
    return this.has(key) && this.deleteKey(key);
  }

  clear(): void {
    this.valueMap.clear();
    this.lruKeys = [];
  }

  get size(): number {
    return this.valueMap.size;
  }

  keys(): IterableIterator<K> {
    return this.lruKeys.slice().values();
  }

  values(): IterableIterator<V> {
    return new Map(this.valueMap).values();
  }

  entries(): IterableIterator<[K, V]> {
    return new Map(this.valueMap).entries();
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  has(key: K): boolean {
    return this.valueMap.has(key);
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    new Map(this.valueMap).forEach(callbackfn, thisArg);
  }

  get [Symbol.toStringTag]() {
    return 'LRUCacheMap';
  }

  peek(key: K): V | undefined {
    return this.valueMap.get(key);
  }

  deleteKey(key: K): boolean {
    let result = false;
    this.removeKeyFromLRU(key);

    if (this.valueMap.get(key) !== undefined) {
      result = this.valueMap.delete(key);
    }

    return result;
  }

  private removeKeyFromLRU(key: K): void {
    const index = this.lruKeys.indexOf(key);
    if (index !== -1) {
      this.lruKeys.splice(index, 1);
    }
  }

  private touchKeyInLRU(key: K): void {
    this.removeKeyFromLRU(key);
    this.lruKeys.push(key);
  }
}
