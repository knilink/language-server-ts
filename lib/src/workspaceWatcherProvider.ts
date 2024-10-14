import { WatchedFilesError, WorkspaceWatcher, WorkspaceWatcherEventListener } from './workspaceWatcher.ts';
import { Context } from './context.ts';
import { conversationLogger } from './conversation/logger.ts';
import { LRUCacheMap } from './common/cache.ts';
import { TextDocument } from './textDocument.ts';
import { WorkspaceFolder } from 'vscode-languageserver-types';

// ./conversation/skills/ProjectContextSkill.ts

abstract class WorkspaceWatcherProvider {
  abstract createWatcher(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): WorkspaceWatcher;
  // ./conversation/skills/ProjectContextSkill.ts
  abstract shouldStartWatching(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): boolean;

  private watchers = new LRUCacheMap<string, WorkspaceWatcher>(25);

  constructor(readonly ctx: Context) {}

  getWatcher(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): WorkspaceWatcher | undefined {
    const watcher = this.watchers.get(workspaceFolder.uri);
    if (watcher) return watcher;
    const parentWatcher = [...this.watchers.keys()].find((watchedFolder) =>
      workspaceFolder.uri.startsWith(watchedFolder)
    );
    return parentWatcher ? this.watchers.get(parentWatcher) : undefined;
  }

  hasWatcher(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): boolean {
    return (
      [...this.watchers.keys()].some((watchedFolder) => workspaceFolder.uri.startsWith(watchedFolder)) ||
      this.getWatcher(workspaceFolder) !== undefined
    );
  }

  startWatching(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): void {
    conversationLogger.debug(this.ctx, `WorkspaceWatcherProvider - Start watching workspace ${workspaceFolder.uri}`);
    if (this.hasWatcher(workspaceFolder)) {
      const watcher = this.getWatcher(workspaceFolder);
      watcher?.startWatching();
      return;
    }
    const newWatcher = this.createWatcher(workspaceFolder);
    // MARK should startWatching()?
    this.watchers.set(workspaceFolder.uri, newWatcher);
  }

  stopWatching(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): void {
    this.getWatcher(workspaceFolder)?.stopWatching();
  }

  terminateSubfolderWatchers(workspaceFolder: Pick<WorkspaceFolder, 'uri'>) {
    const watchedFolders = [...this.watchers.keys()];
    const parentFolder = workspaceFolder.uri.replace(/[#?].*/, '').replace(/\/?$/, '/');
    const subfolders = watchedFolders.filter(
      (watchedFolder) => watchedFolder !== workspaceFolder.uri && watchedFolder.startsWith(parentFolder)
    );

    for (let uri of subfolders) this.terminateWatching({ uri });
  }

  terminateWatching(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): boolean | undefined {
    if (this.getWatcher(workspaceFolder)?.status !== 'stopped') {
      this.stopWatching(workspaceFolder);
      return this.watchers.delete(workspaceFolder.uri);
    }
    this.watchers.delete(workspaceFolder.uri);
  }

  onFileChange(workspaceFolder: Pick<WorkspaceFolder, 'uri'>, listener: WorkspaceWatcherEventListener): void {
    this.getWatcher(workspaceFolder)?.onFileChange(listener);
  }

  async getWatchedFiles(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): Promise<TextDocument[] | WatchedFilesError> {
    return (await this.getWatcher(workspaceFolder)?.getWatchedFiles()) ?? [];
  }

  getStatus(workspaceFolder: Pick<WorkspaceFolder, 'uri'>) {
    return this.getWatcher(workspaceFolder)?.status;
  }
}

export { WorkspaceWatcherProvider, WorkspaceWatcher };
