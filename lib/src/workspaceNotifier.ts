import { WorkspaceFoldersChangeEvent } from 'vscode-languageserver';
import { EventEmitter } from 'node:events';
import { URI } from 'vscode-uri';

type WorkspaceFoldersChangeUriEvent = {
  added: URI[];
  removed: URI[];
};

class WorkspaceNotifier {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
  }

  onChange(listener: (event: WorkspaceFoldersChangeUriEvent) => void): void {
    this.emitter.on('onWorkspaceChanged', listener);
  }

  emit(event: WorkspaceFoldersChangeUriEvent): void {
    this.emitter.emit('onWorkspaceChanged', event);
  }
}

export { WorkspaceNotifier };
