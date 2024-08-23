export function shortCircuit<A extends unknown[], R extends unknown, T extends unknown>(
  fn: (this: T, ...args: A) => Promise<R>,
  shortCircuitMs: number,
  shortCircuitReturn: R
): (this: T, ...args: A) => Promise<R> {
  return async function(...args: A): Promise<R> {
    return await Promise.race([
      fn.apply(this, args),
      new Promise<R>((resolve) => {
        setTimeout(resolve, shortCircuitMs, shortCircuitReturn);
      }),
    ]);
  };
}
