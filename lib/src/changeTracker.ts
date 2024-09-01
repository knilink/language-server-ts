import { type URI } from 'vscode-uri';
import { Context } from "./context.ts";
import { TextDocumentManager } from "./textDocumentManager.ts";

class ChangeTracker {
  private _referenceCount = 0;
  private _isDisposed = false;
  private _offset: number;
  private readonly _tracker: { dispose(): void };

  constructor(ctx: Context, fileURI: URI, insertionOffset: number) {
    this._offset = insertionOffset;

    const documentManager = ctx.get(TextDocumentManager);

    this._tracker = documentManager.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === fileURI.toString()) {
        for (const cc of e.contentChanges) {
          if (cc.rangeOffset + cc.rangeLength <= this._offset) {
            const delta = cc.text.length - cc.rangeLength;
            this._offset += delta;
          }
        }
      }
    });
  }

  get offset(): number {
    return this._offset;
  }

  push(action: () => void, timeout: number): void {
    if (this._isDisposed) throw new Error('Unable to push new actions to a disposed ChangeTracker');

    this._referenceCount++;
    setTimeout(() => {
      action();
      this._referenceCount--;
      if (this._referenceCount === 0) {
        this._tracker.dispose();
        this._isDisposed = true;
      }
    }, timeout);
  }
}

export { ChangeTracker };
