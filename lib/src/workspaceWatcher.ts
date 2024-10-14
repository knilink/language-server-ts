import { EventEmitter } from 'node:events';
import { Context } from './context.ts';
import { TextDocument } from './textDocument.ts';
import { DocumentUri } from 'vscode-languageserver-types';

type WorkspaceWatcherFileEvent =
  | {
      type: 'create';
      documents: TextDocument[];
      workspaceFolder: { uri: DocumentUri };
    }
  | {
      type: 'update';
      documents: TextDocument[];
      workspaceFolder: { uri: DocumentUri };
    }
  | {
      type: 'delete';
      documents: { uri: DocumentUri }[];
      workspaceFolder: { uri: DocumentUri };
    };

type WorkspaceWatcherEventListener = (event: WorkspaceWatcherFileEvent) => void;

class WatchedFilesError extends Error {
  readonly name = 'WatchedFilesError';
  constructor(readonly cause: unknown) {
    super(String(cause));
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
    readonly workspaceFolder: { uri: DocumentUri }
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
      documents,
      workspaceFolder: this.workspaceFolder,
    });
  }

  public onFilesUpdated(documents: TextDocument[]): void {
    this.emitter.emit(workspaceWatcherFileEvent, {
      type: 'update',
      documents,
      workspaceFolder: this.workspaceFolder,
    });
  }

  public onFilesDeleted(documents: { uri: DocumentUri }[]): void {
    this.emitter.emit(workspaceWatcherFileEvent, {
      type: 'delete',
      documents,
      workspaceFolder: this.workspaceFolder,
    });
  }
}

export { WorkspaceWatcher, WorkspaceWatcherEventListener, WorkspaceWatcherFileEvent, WatchedFilesError };
