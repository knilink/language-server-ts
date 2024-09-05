type ContextKey<T> = abstract new (...args: any[]) => T;

class Context {
  readonly instances = new Map<ContextKey<any>, any>();

  get<T>(ctor: ContextKey<T>): T {
    const value = this.tryGet(ctor);
    if (value) return value;
    throw new Error(`No instance of ${ctor.name} has been registered.`);
  }

  tryGet<T>(ctor: ContextKey<T>): T | undefined {
    const value = this.instances.get(ctor);
    if (value) return value;
  }

  set<T>(ctor: ContextKey<T>, instance: T): void {
    if (this.tryGet(ctor)) {
      throw new Error(
        `An instance of ${ctor.name} has already been registered. Use forceSet() if you're sure it's a good idea.`
      );
    }
    this.assertIsInstance(ctor, instance);
    this.instances.set(ctor, instance);
  }

  forceSet<T>(ctor: ContextKey<T>, instance: T): void {
    this.assertIsInstance(ctor, instance);
    this.instances.set(ctor, instance);
  }

  assertIsInstance<T>(ctor: ContextKey<T>, instance: any): void {
    if (!(instance instanceof ctor)) {
      const inst = JSON.stringify(instance);
      throw new Error(`The instance you're trying to register for ${ctor.name} is not an instance of it (${inst}).`);
    }
  }
}

export { Context };
