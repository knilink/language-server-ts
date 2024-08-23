import { LspFileWatcher } from '../lspFileWatcher';
import { WorkspaceWatcher } from '../../../lib/src/workspaceWatcher';
import { type URI } from 'vscode-uri';

class AgentWorkspaceWatcher extends WorkspaceWatcher {
  async getWatchedFiles(): Promise<URI[]> {
    return (
      await this.ctx.get(LspFileWatcher).getWatchedFiles({
        workspaceUri: this.workspaceFolder.toString(),
        excludeGitignoredFiles: true,
        excludeIDEIgnoredFiles: true,
      })
    ).watchedFiles;
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

    const createdFiles = event.created.filter((file) => !file.isRestricted && !file.isUnknownFileExtension);
    if (createdFiles.length > 0) {
      this.onFilesCreated(createdFiles.map((file) => file.uri));
    }

    const updatedFiles = event.changed.filter((file) => !file.isRestricted && !file.isUnknownFileExtension);
    if (updatedFiles.length > 0) {
      this.onFilesUpdated(updatedFiles.map((file) => file.uri));
    }

    const deletedFiles = event.deleted.filter((file) => !file.isRestricted && !file.isUnknownFileExtension);
    if (deletedFiles.length > 0) {
      this.onFilesDeleted(deletedFiles.map((file) => file.uri));
    }
  }
}

export { AgentWorkspaceWatcher };
