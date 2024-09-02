import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Debouncer } from './debounce.ts';

describe('Debouncer', () => {
  let debouncer: Debouncer;

  beforeEach(() => {
    vi.useFakeTimers();
    debouncer = new Debouncer();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should resolve immediately if called once', async () => {
    const mockResolve = vi.fn();
    debouncer.debounce(10).then(mockResolve);

    await vi.advanceTimersByTimeAsync(10);
    expect(mockResolve).toHaveBeenCalled();
  });

  it('should only resolve after the specified time if called multiple times', async () => {
    const mockResolve = vi.fn();
    const mockReject = vi.fn();

    debouncer.debounce(50).then(mockResolve).catch(mockReject);

    await vi.advanceTimersByTimeAsync(25);

    debouncer.debounce(50).then(mockResolve);

    await vi.advanceTimersByTimeAsync(50);

    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockReject).toHaveBeenCalledTimes(1);
  });
});
