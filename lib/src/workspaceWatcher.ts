import { EventEmitter } from 'node:events';
import { URI } from 'vscode-uri';
import { Context } from './context.ts';
import { TextDocument } from './textDocument.ts';

type WorkspaceWatcherFileEvent = {
  type: 'create' | 'update' | 'delete';
  uris: URI[];
  documents: TextDocument[];
  workspaceFolder: URI;
};

type WorkspaceWatcherEventListener = (event: WorkspaceWatcherFileEvent) => void;

class WatchedFilesError extends Error {
  readonly name = 'WatchedFilesError';
  constructor(message: string) {
    super(message);
  }
}

const workspaceWatcherFileEvent = 'onWorkspaceWatcherChanged';

abstract class WorkspaceWatcher {
  abstract startWatching(): void;
  abstract stopWatching(): void;
  abstract getWatchedFiles(): Promise<TextDocument[] | WatchedFilesError>;

  private emitter = new EventEmitter<{ [workspaceWatcherFileEvent]: [WorkspaceWatcherFileEvent] }>();
  status:
    | 'created'
    | 'stopped'
    // ../../agent/src/workspaceWatcher/agentWatcher.ts
    | 'ready' = 'created';

  constructor(
    readonly ctx: Context,
    // URI ../../agent/src/workspaceWatcher/agentWatcher.ts
    readonly workspaceFolder: URI
  ) {
    this.emitter = new EventEmitter();
    this.startWatching();
  }

  public onFileChange(listener: WorkspaceWatcherEventListener): void {
    this.emitter.on(workspaceWatcherFileEvent, listener);
  }

  public onFilesCreated(documents: TextDocument[]): void {
    this.emitter.emit(workspaceWatcherFileEvent, {
      type: 'create',
      uris: documents.map((doc) => doc.vscodeUri),
      documents,
      workspaceFolder: this.workspaceFolder,
    });
  }

  public onFilesUpdated(documents: TextDocument[]): void {
    this.emitter.emit(workspaceWatcherFileEvent, {
      type: 'update',
      uris: documents.map((doc) => doc.vscodeUri),
      documents,
      workspaceFolder: this.workspaceFolder,
    });
  }

  public onFilesDeleted(uris: URI[]): void {
    this.emitter.emit(workspaceWatcherFileEvent, {
      type: 'delete',
      uris,
      documents: [],
      workspaceFolder: this.workspaceFolder,
    });
  }
}

export { WorkspaceWatcher, WorkspaceWatcherEventListener, WorkspaceWatcherFileEvent, WatchedFilesError };
