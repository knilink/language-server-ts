class Deferred<T> {
  _resolve: (value: T | PromiseLike<T>) => void = () => {};
  _reject: (reason?: unknown) => void = () => {};
  promise: Promise<T>;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  resolve(value: T): void {
    this._resolve(value);
  }

  reject(reason?: unknown): void {
    this._reject(reason);
  }
}

export { Deferred };
