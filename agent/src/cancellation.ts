import type { CancellationToken } from 'vscode-languageserver/node.js';
import {} from '../../types/src/index.ts';

export const shortcutEvent = (callback: () => void, context?: CancellationToken): { dispose(): void } => {
  let handle = setTimeout(callback.bind(context), 0);
  return {
    dispose() {
      clearTimeout(handle);
    },
  };
};

class MergedToken implements CancellationToken {
  private tokens: CancellationToken[];
  private handlers: ((token?: CancellationToken) => void)[];
  private _isCancelled: boolean;

  constructor(tokens: CancellationToken[]) {
    this.tokens = tokens;
    this.handlers = [];
    this._isCancelled = this.tokens.some((t) => t.isCancellationRequested);

    this.tokens.forEach((t) => {
      t.onCancellationRequested(this.cancel, this);
    });
  }

  cancel(event?: CancellationToken): void {
    if (!this._isCancelled) {
      this._isCancelled = true;
      this.handlers.forEach((handler) => handler(event));
    }
  }

  get isCancellationRequested(): boolean {
    return this.tokens.some((t) => t.isCancellationRequested);
  }

  onCancellationRequested = (
    listener: (token?: CancellationToken) => void,
    thisArgs?: CancellationToken
  ): { dispose(): void } => {
    if (this._isCancelled) {
      return shortcutEvent(() => listener.call(thisArgs), thisArgs);
    } else {
      this.handlers.push(listener.bind(thisArgs));
      return { dispose: () => {} };
    }
  };

  dispose(): void {
    this.tokens = [];
  }
}

export { MergedToken };
