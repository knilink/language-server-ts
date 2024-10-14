import { WorkspaceFoldersChangeEvent } from 'vscode-languageserver';
import { EventEmitter } from 'node:events';
import { URI } from 'vscode-uri';

class WorkspaceNotifier {
  emitter: EventEmitter<{ onWorkspaceChanged: [WorkspaceFoldersChangeEvent] }>;

  constructor() {
    this.emitter = new EventEmitter();
  }

  onChange(listener: (event: WorkspaceFoldersChangeEvent) => void): void {
    this.emitter.on('onWorkspaceChanged', listener);
  }

  emit(event: WorkspaceFoldersChangeEvent): void {
    this.emitter.emit('onWorkspaceChanged', event);
  }
}

export { WorkspaceNotifier };
