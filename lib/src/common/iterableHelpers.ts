export async function* asyncIterableMap<T, U>(
  source: AsyncIterable<T>,
  selector: (item: T) => Promise<U>
): AsyncGenerator<U> {
  for await (const item of source) yield selector(item);
}

export async function* asyncIterableFilter<T>(
  source: AsyncIterable<T>,
  predicate: (item: T) => Promise<boolean>
): AsyncGenerator<T> {
  for await (const item of source) if (await predicate(item)) yield item;
}

export async function* asyncIterableMapFilter<T, U>(
  source: AsyncIterable<T>,
  selector: (item: T) => Promise<U | undefined>
): AsyncGenerator<U> {
  for await (const item of source) {
    const result = await selector(item);
    if (result !== undefined) yield result;
  }
}

export async function* asyncIterableFromArray<T>(source: T[]): AsyncGenerator<T> {
  for (const item of source) yield item;
}
