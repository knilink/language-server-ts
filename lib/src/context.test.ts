import { describe, it, expect } from 'vitest';
import { Context } from "./context.ts";

class TestClassA {
  constructor(public name: string) { }
}

class TestClassB {
  constructor(public age: number) { }
}

describe('Context', () => {
  it('should register and retrieve instances properly', () => {
    const context = new Context();
    const instanceA = new TestClassA('Instance A');
    context.set(TestClassA, instanceA);

    const retrievedA = context.get(TestClassA);
    expect(retrievedA).toBe(instanceA);
  });

  it('should throw an error when trying to register the same class twice', () => {
    const context = new Context();
    const instanceA1 = new TestClassA('Instance A1');
    const instanceA2 = new TestClassA('Instance A2');

    context.set(TestClassA, instanceA1);

    expect(() => {
      context.set(TestClassA, instanceA2);
    }).toThrow(
      `An instance of ${TestClassA.name} has already been registered. Use forceSet() if you're sure it's a good idea.`
    );
  });

  it('should throw an error when trying to retrieve an unregistered class', () => {
    const context = new Context();

    expect(() => {
      context.get(TestClassB);
    }).toThrow(`No instance of ${TestClassB.name} has been registered.`);
  });

  it('should allow force setting an instance even if already registered', () => {
    const context = new Context();
    const instanceA1 = new TestClassA('Instance A1');
    const instanceA2 = new TestClassA('Instance A2');

    context.set(TestClassA, instanceA1);
    context.forceSet(TestClassA, instanceA2);

    const retrievedA = context.get(TestClassA);
    expect(retrievedA).toBe(instanceA2);
  });

  it('should throw an error when trying to register a non-matching instance', () => {
    const context = new Context();

    const badInstance = {}; // Not an instance of TestClassB

    expect(() => {
      context.set(TestClassB, badInstance as any);
    }).toThrow(`The instance you're trying to register for ${TestClassB.name} is not an instance of it`);
  });
});
