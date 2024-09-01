import { InitializeParams as LSPInitializeParams } from "vscode-languageserver/node.js";
import { EventEmitter } from 'events';

namespace InitializedNotifier {
  export type InitializeParams = LSPInitializeParams & {
    copilotCapabilities: { fetch: boolean };
  };
}

class InitializedNotifier {
  private emitter = new EventEmitter<{ initialize: [InitializedNotifier.InitializeParams] }>();
  private initialized = false;

  constructor() { }

  public once(listener: (options: InitializedNotifier.InitializeParams) => void): void {
    this.emitter.once('initialize', listener);
  }

  public emit(options: InitializedNotifier.InitializeParams): void {
    if (this.initialized) {
      throw new Error('Already initialized');
    }

    this.initialized = true;
    this.emitter.emit('initialize', options);
  }
}

export { InitializedNotifier };
