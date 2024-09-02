import { describe, it, expect } from 'vitest';
import {
  asyncIterableMap,
  asyncIterableFilter,
  asyncIterableMapFilter,
  asyncIterableFromArray,
} from './iterableHelpers.ts';

describe('asyncIterableMap', () => {
  it('maps values correctly', async () => {
    const input = [1, 2, 3];
    const result: number[] = [];

    for await (const item of asyncIterableMap(asyncIterableFromArray(input), async (x: number) => x * 2)) {
      result.push(item);
    }

    expect(result).toEqual([2, 4, 6]);
  });
});

describe('asyncIterableFilter', () => {
  it('filters values correctly', async () => {
    const input = [1, 2, 3, 4];
    const result: number[] = [];

    for await (const item of asyncIterableFilter(asyncIterableFromArray(input), async (x: number) => x % 2 === 0)) {
      result.push(item);
    }

    expect(result).toEqual([2, 4]);
  });
});

describe('asyncIterableMapFilter', () => {
  it('maps and filters values correctly', async () => {
    const input = [1, 2, 3, 4];
    const result: number[] = [];

    for await (const item of asyncIterableMapFilter(asyncIterableFromArray(input), async (x: number) =>
      x % 2 === 0 ? x * 10 : undefined
    )) {
      result.push(item);
    }

    expect(result).toEqual([20, 40]);
  });
});
