import { CancellationToken, CancellationTokenSource, MergedToken } from './cancellation.ts';
import { LRUCacheMap } from '../../lib/src/common/cache.ts';

class WorkDoneProgressTokens {
  private tokens: LRUCacheMap<string, CancellationTokenSource>;

  constructor() {
    this.tokens = new LRUCacheMap(250);
  }

  add(
    // string|number methods/conversation/conversationTurn.ts
    workDoneProgressToken: string | number,
    cancellationToken: CancellationToken
  ): MergedToken {
    const cts = new CancellationTokenSource();
    const mergedToken = new MergedToken([cancellationToken, cts.token]);
    this.tokens.set(workDoneProgressToken.toString(), cts);
    return mergedToken;
  }

  cancel(workDoneProgressToken: CancellationToken): void {
    const cts = this.tokens.get(workDoneProgressToken.toString());
    if (cts) {
      cts.cancel();
      this.tokens.delete(workDoneProgressToken.toString());
    }
  }
}

export { WorkDoneProgressTokens };
