import type { Context } from './context.ts';
import type { CopilotTextDocument } from './textDocument.ts';

import { LRUCacheMap } from './common/cache.ts';
import { TextDocumentManager } from './textDocumentManager.ts';

const accessTimes = new LRUCacheMap<string, number>();

function sortByAccessTimes(docs: CopilotTextDocument[]): CopilotTextDocument[] {
  return [...docs].sort((a, b) => {
    const aAccessTime = accessTimes.get(a.uri.toString()) ?? 0;
    const bAccessTime = accessTimes.get(b.uri.toString()) ?? 0;
    return bAccessTime - aAccessTime;
  });
}

function registerDocumentTracker(ctx: Context): void {
  ctx.get(TextDocumentManager).onDidFocusTextDocument((e?: TextDocumentManager.DidFocusTextDocumentParams) => {
    if (e) {
      accessTimes.set(e.document.uri.toString(), Date.now());
    }
  });
}

export { registerDocumentTracker, sortByAccessTimes };
