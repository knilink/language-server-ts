import { EventEmitter } from 'events';
import { URI } from 'vscode-uri';
import { Context } from "./context.ts";

type WorkspaceWatcherFileEvent = {
  type: 'create' | 'update' | 'delete';
  files: URI[];
  workspaceFolder: URI;
};

type WorkspaceWatcherEventListener = (event: WorkspaceWatcherFileEvent) => void;
const workspaceWatcherFileEvent = 'onWorkspaceWatcherChanged';

abstract class WorkspaceWatcher {
  abstract startWatching(): void;
  abstract stopWatching(): void;
  abstract getWatchedFiles(): Promise<URI[]>;

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

  public onFilesCreated(files: URI[]): void {
    this.emitEvent({ type: 'create', files, workspaceFolder: this.workspaceFolder });
  }

  public onFilesUpdated(files: URI[]): void {
    this.emitEvent({ type: 'update', files, workspaceFolder: this.workspaceFolder });
  }

  public onFilesDeleted(files: URI[]): void {
    this.emitEvent({ type: 'delete', files, workspaceFolder: this.workspaceFolder });
  }

  private emitEvent(event: WorkspaceWatcherFileEvent): void {
    this.emitter.emit(workspaceWatcherFileEvent, event);
  }
}

export { WorkspaceWatcher, WorkspaceWatcherEventListener, WorkspaceWatcherFileEvent };
