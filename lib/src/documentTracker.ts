import { type URI } from 'vscode-uri';

import { type Context } from './context';
import { TextDocumentManager } from './textDocumentManager';
import { LRUCacheMap } from './common/cache';
import { TextDocument } from './textDocument';

const accessTimes = new LRUCacheMap<string, number>();

function sortByAccessTimes(docs: TextDocument[]): TextDocument[] {
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
