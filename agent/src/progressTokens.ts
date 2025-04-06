import { CancellationToken, CancellationTokenSource } from 'vscode-languageserver';
import type { WorkDoneToken } from '../../lib/src/types.ts';
import { MergedToken } from './cancellation.ts';
import { LRUCacheMap } from '../../lib/src/common/cache.ts';

class ProgressTokens {
  tokens = new LRUCacheMap<string, CancellationTokenSource>(250);
  constructor() {}
  add(progressToken: WorkDoneToken, cancellationToken: CancellationToken) {
    const cts = new CancellationTokenSource();
    const mergedToken = new MergedToken([cancellationToken, cts.token]);
    this.tokens.set(progressToken.toString(), cts);
    return mergedToken;
  }
  cancel(progressToken: WorkDoneToken) {
    const cts = this.tokens.get(progressToken.toString());

    if (cts) {
      cts.cancel();
      this.tokens.delete(progressToken.toString());
    }
  }
}

export { ProgressTokens };
