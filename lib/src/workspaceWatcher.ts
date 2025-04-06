import type { Context } from './context.ts';
import type { DocumentUri } from 'vscode-languageserver-types';
import { CopilotTextDocument } from './textDocument.ts';

import { EventEmitter } from 'node:events';
import { telemetryCatch } from './telemetry.ts';

type WorkspaceWatcherFileEvent =
  | {
      type: 'create';
      documents: CopilotTextDocument[];
      workspaceFolder: { uri: DocumentUri };
    }
  | {
      type: 'update';
      documents: CopilotTextDocument[];
      workspaceFolder: { uri: DocumentUri };
    }
  | {
      type: 'delete';
      documents: { uri: DocumentUri }[];
      workspaceFolder: { uri: DocumentUri };
    };

type WorkspaceWatcherEventListener = (event: WorkspaceWatcherFileEvent) => void;

const workspaceWatcherFileEvent = 'onWorkspaceWatcherChanged';

abstract class WorkspaceWatcher {
  abstract startWatching(): void;
  abstract stopWatching(): void;
  abstract getWatchedFiles(): Promise<CopilotTextDocument[]>;

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
    this.emitter.on(workspaceWatcherFileEvent, telemetryCatch(this.ctx, listener, 'WorkspaceWatcher.onFileChange'));
  }

  public onFilesCreated(documents: CopilotTextDocument[]): void {
    this.emitter.emit(workspaceWatcherFileEvent, {
      type: 'create',
      documents,
      workspaceFolder: this.workspaceFolder,
    });
  }

  public onFilesUpdated(documents: CopilotTextDocument[]): void {
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

export { WorkspaceWatcher };

export type { WorkspaceWatcherEventListener };
