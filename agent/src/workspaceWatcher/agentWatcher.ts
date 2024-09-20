import { type URI } from 'vscode-uri';

import { LspFileWatcher } from '../lspFileWatcher.ts';
import { WatchedFilesError, WorkspaceWatcher } from '../../../lib/src/workspaceWatcher.ts';

class AgentWorkspaceWatcher extends WorkspaceWatcher {
  async getWatchedFiles(): Promise<URI[] | WatchedFilesError> {
    const files = await this.ctx.get(LspFileWatcher).getWatchedFiles({
      workspaceUri: this.workspaceFolder.toString(),
      excludeGitignoredFiles: true,
      excludeIDEIgnoredFiles: true,
    });
    return files instanceof WatchedFilesError ? files : files.watchedFiles;
  }

  startWatching(): void {
    if (this.status === 'ready') return;

    this.ctx.get(LspFileWatcher).onDidChangeWatchedFiles(this.onDidChangeWatchedFilesHandler.bind(this));
    this.status = 'ready';
  }

  stopWatching() {
    this.status = 'stopped';
    this.ctx.get(LspFileWatcher).offDidChangeWatchedFiles(this.onDidChangeWatchedFilesHandler.bind(this));
  }

  onDidChangeWatchedFilesHandler(event: LspFileWatcher.ChangeWatchedFilesEvent): void {
    if (event.workspaceFolder.fsPath !== this.workspaceFolder.fsPath) return;
    let createdFiles = event.created.filter((file) => !file.isRestricted && !file.isUnknownFileExtension);
    if (createdFiles.length) {
      let documents = createdFiles.map((file) => file.document).filter((doc) => doc !== undefined);
      this.onFilesCreated(documents);
    }
    let updatedFiles = event.changed.filter((file) => !file.isRestricted && !file.isUnknownFileExtension);
    if (updatedFiles.length) {
      let documents = updatedFiles.map((file) => file.document).filter((doc) => doc !== undefined);
      this.onFilesUpdated(documents);
    }
    let deletedFiles = event.deleted.filter((file) => !file.isRestricted && !file.isUnknownFileExtension);

    if (deletedFiles.length) {
      this.onFilesDeleted(deletedFiles.map((file) => file.uri));
    }
  }
}

export { AgentWorkspaceWatcher };
