class PromiseQueue {
  protected promises: Set<Promise<unknown>>;

  constructor() {
    this.promises = new Set();
  }

  register(promise: Promise<void>): void {
    this.promises.add(promise);
    promise.finally(() => this.promises.delete(promise));
  }

  async flush(): Promise<void> {
    await Promise.all(this.promises);
  }
}

export { PromiseQueue };
