import { CancellationToken, CancellationTokenSource } from 'vscode-languageserver';

export const shortcutEvent = (callback: () => void, context?: CancellationToken): { dispose(): void } => {
  let handle = setTimeout(callback.bind(context), 0);
  return {
    dispose() {
      clearTimeout(handle);
    },
  };
};

// const doNothing = () => { };
//
// export const none = Object.freeze({
//   isCancellationRequested: false,
//   onCancellationRequested: () => ({ dispose: doNothing }),
//   cancel: doNothing,
// });
//
// export const cancelled = Object.freeze({
//   isCancellationRequested: true,
//   onCancellationRequested: shortcutEvent,
//   cancel: doNothing,
// });
//
// class MutableToken implements CancellationToken {
//   private _isCancelled: boolean;
//   private handlers: ((token?: any) => void)[];
//
//   constructor() {
//     this._isCancelled = false;
//     this.handlers = [];
//   }
//
//   cancel(): void {
//     if (!this._isCancelled) {
//       this._isCancelled = true;
//       this.handlers.forEach((handler) => handler());
//     }
//   }
//
//   get isCancellationRequested(): boolean {
//     return this._isCancelled;
//   }
//
//   onCancellationRequested(
//     listener: (token?: CancellationToken) => void,
//     thisArgs?: CancellationToken
//   ): { dispose(): void } {
//     if (this._isCancelled) {
//       return shortcutEvent(() => listener.call(thisArgs), thisArgs);
//     } else {
//       this.handlers.push(listener.bind(thisArgs));
//       return { dispose: () => { } };
//     }
//   }
//
//   dispose(): void {
//     this.handlers = [];
//   }
// }

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

  cancel(): void {
    if (!this._isCancelled) {
      this._isCancelled = true;
      this.handlers.forEach((handler) => handler(void 0));
    }
  }

  get isCancellationRequested(): boolean {
    return this.tokens.some((t) => t.isCancellationRequested);
  }

  onCancellationRequested(
    listener: (token?: CancellationToken) => void,
    thisArgs?: CancellationToken
  ): { dispose(): void } {
    if (this._isCancelled) {
      return shortcutEvent(() => listener.call(thisArgs), thisArgs);
    } else {
      this.handlers.push(listener.bind(thisArgs));
      return { dispose: () => {} };
    }
  }

  dispose(): void {
    this.tokens = [];
  }
}

// class CancellationTokenSource implements AbstractCancellationTokenSource {
//   private _token?: CancellationToken;
//   private _parentListener?: { dispose(): void };
//
//   constructor(parent?: any) {
//     this._parentListener = parent && parent.onCancellationRequested(this.cancel, this);
//   }
//
//   get token(): CancellationToken {
//     if (!this._token) {
//       this._token = new MutableToken();
//     }
//     return this._token;
//   }
//
//   cancel(): void {
//     if (this._token) {
//       if (this._token instanceof MutableToken) {
//         this._token.cancel();
//       } else {
//         this._token = cancelled;
//       }
//     }
//   }
//
//   dispose(cancel: boolean = false): void {
//     if (cancel) this.cancel();
//     if (this._parentListener) this._parentListener.dispose();
//     if (this._token && this._token instanceof MutableToken) {
//       this._token.dispose();
//     } else {
//       this._token = none;
//     }
//   }
// }

export { CancellationToken, CancellationTokenSource, MergedToken };
