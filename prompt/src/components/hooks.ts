import { UseState, UseData, UseEffect } from '../../../lib/src/prompt/jsxTypes.ts';

class UseState implements UseState.IUseState {
  currentIndex = 0;
  stateChanged = false;

  constructor(readonly states: any[]) {}

  useState<S>(initialState?: (() => S) | S): [S, UseState.Dispatch<UseState.BasicStateAction<S>>] {
    const index = this.currentIndex;
    if (this.states[index] === undefined) {
      const initial = typeof initialState === 'function' ? (initialState as () => S)() : initialState;
      this.states[index] = initial;
    }

    const setState = (newState: UseState.BasicStateAction<S>) => {
      let nextState = typeof newState == 'function' ? (newState as (prevState: S) => S)(this.states[index]) : newState;
      this.states[index] = nextState;
      this.stateChanged = true;
    };
    this.currentIndex++;
    return [this.states[index], setState];
  }

  hasChanged() {
    return this.stateChanged;
  }
}

class UseData implements UseData.IUseData {
  consumers: UseData.Consumer<any>[] = [];
  constructor(readonly measureUpdateTime: (ms: number) => void) {}

  useData<T>(typePredicate: UseData.Consumer<T>['predicate'], consumer: UseData.Consumer<T>['consumer']) {
    this.consumers.push({
      predicate: typePredicate,
      consumer: (data: T) => {
        if (typePredicate(data)) {
          return consumer(data);
        }
      },
    });
  }

  async updateData(data: unknown) {
    if (this.consumers.length > 0) {
      let start = performance.now();
      for (let { predicate, consumer } of this.consumers) predicate(data) && (await consumer(data));
      this.measureUpdateTime(performance.now() - start);
    }
  }
}

class UseEffect implements UseEffect.IUseEffect {
  effects: (() => Promise<() => Promise<void>>)[] = [];
  cleanupFunctions: (() => Promise<void>)[] = [];
  constructor() {}
  useEffect(effect: () => Promise<() => Promise<void>>) {
    this.effects.push(effect);
  }
  async runEffects() {
    for (let effect of this.effects) {
      let cleanup = await effect();

      if (cleanup) {
        this.cleanupFunctions.push(cleanup);
      }
    }
    this.effects = [];
  }
  async cleanup() {
    for (let cleanup of this.cleanupFunctions) await cleanup();
  }
}

export { UseData, UseEffect, UseState };
