import { InitializeParams as LSPInitializeParams } from 'vscode-languageserver/node.js';
import { EventEmitter } from 'node:events';

namespace InitializedNotifier {
  export type InitializeParams = LSPInitializeParams & {
    copilotCapabilities: { fetch: boolean };
  };
}

class InitializedNotifier {
  private emitter = new EventEmitter<{ initialize: [] }>();
  private initialized = false;

  constructor() {}

  public once(listener: () => void): void {
    this.emitter.once('initialize', listener);
  }

  public emit(): void {
    if (this.initialized) {
      throw new Error('Already initialized');
    }

    this.initialized = true;
    this.emitter.emit('initialize');
  }
}

export { InitializedNotifier };
