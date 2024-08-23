class PromiseQueue {
  protected promises: Set<Promise<unknown>>;

  constructor() {
    this.promises = new Set();
  }

  async register(promise: Promise<unknown>): Promise<void> {
    this.promises.add(promise);
    try {
      await promise;
    } finally {
      this.promises.delete(promise);
    }
    return;
  }

  async flush(): Promise<void> {
    await Promise.all(this.promises);
  }
}

export { PromiseQueue };
