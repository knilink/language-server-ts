import type { ContextItemResolution } from './contextProviders/contextItemSchemas.ts';

import { CONTENT_EXCLUDED_EXPECTATION } from './contextProviders/codeSnippets.ts';

class ContextProviderStatistics {
  readonly _expectations = new Map<string, string[]>();
  readonly _lastResolution = new Map<string, ContextItemResolution>();
  readonly _statistics = new Map<string, { usage: string; resolution: ContextItemResolution }>();

  addExpectations(providerId: string, expectations: string[]) {
    const providerExpectations = this._expectations.get(providerId) ?? [];
    this._expectations.set(providerId, [...providerExpectations, ...expectations]);
  }

  setLastResolution(providerId: string, resolution: ContextItemResolution) {
    this._lastResolution.set(providerId, resolution);
  }

  get(providerId: string) {
    return this._statistics.get(providerId);
  }

  // ./contextProviderRegistry.ts
  pop(providerId: string) {
    const statistics = this._statistics.get(providerId);
    if (statistics) {
      this._statistics.delete(providerId);
      return statistics;
    }
  }

  computeMatchWithPrompt(prompt: string): void {
    for (const [providerId, expectations] of this._expectations) {
      if (expectations.length === 0) {
        continue;
      }
      const resolution = this._lastResolution.get(providerId) ?? 'none';
      if (resolution === 'none') {
        this._statistics.set(providerId, { usage: 'none', resolution: 'none' });
        continue;
      }
      let matched = 0;
      let contentExcluded = false;
      for (const expectation of expectations) {
        if (expectation == CONTENT_EXCLUDED_EXPECTATION) {
          contentExcluded = true;
          continue;
        }

        if (prompt.includes(expectation)) {
          matched++;
        }
      }
      const usage = matched / expectations.length;
      this._statistics.set(providerId, {
        usage: (usage === 1 ? 'full' : usage === 0 ? 'none' : 'partial') + (contentExcluded ? '_content_excluded' : ''), // MARK ???
        resolution,
      });
    }
    this._expectations.clear();
    this._lastResolution.clear();
  }
}

export { ContextProviderStatistics };
