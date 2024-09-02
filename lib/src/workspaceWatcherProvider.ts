import { WorkspaceWatcher, WorkspaceWatcherEventListener } from './workspaceWatcher.ts';
import { Context } from './context.ts';
import { getFsPath, URI } from './util/uri.ts';
import { conversationLogger } from './conversation/logger.ts';
import { LRUCacheMap } from './common/cache.ts';

// ./conversation/skills/ProjectContextSkill.ts

abstract class WorkspaceWatcherProvider {
  abstract createWatcher(workspaceFolder: URI): WorkspaceWatcher;
  // ./conversation/skills/ProjectContextSkill.ts
  abstract shouldStartWatching(folder: URI): boolean;

  private watchers = new LRUCacheMap<string, WorkspaceWatcher>(25);

  constructor(readonly ctx: Context) {}

  getWatcher(workspaceFolder: URI): WorkspaceWatcher | undefined {
    const fsPath = getFsPath(workspaceFolder) || '';
    const watcher = this.watchers.get(fsPath);
    if (watcher) return watcher;
    const parentWatcher = [...this.watchers.keys()].find((watchedFolder: string) => fsPath.startsWith(watchedFolder));
    return parentWatcher ? this.watchers.get(parentWatcher) : undefined;
  }

  hasWatcher(workspaceFolder: URI): boolean {
    const fsPath = getFsPath(workspaceFolder) || '';
    return (
      [...this.watchers.keys()].some((watchedFolder: string) => fsPath.startsWith(watchedFolder)) ||
      this.getWatcher(workspaceFolder) !== undefined
    );
  }

  startWatching(workspaceFolder: URI): void {
    conversationLogger.debug(this.ctx, `WorkspaceWatcherProvider - Start watching workspace ${workspaceFolder}`);
    if (this.hasWatcher(workspaceFolder)) {
      const watcher = this.getWatcher(workspaceFolder);
      watcher?.startWatching();
      return;
    }
    const fsPath = getFsPath(workspaceFolder) || '';
    const newWatcher = this.createWatcher(workspaceFolder);
    // MARK should startWatching()?
    this.watchers.set(fsPath, newWatcher);
  }

  stopWatching(workspaceFolder: URI): void {
    this.getWatcher(workspaceFolder)?.stopWatching();
  }

  async terminateWatching(workspaceFolder: URI): Promise<void> {
    const fsPath = getFsPath(workspaceFolder) || '';
    const watcher = this.getWatcher(workspaceFolder);
    if (watcher && watcher.status !== 'stopped') {
      await this.stopWatching(workspaceFolder);
    }
    this.watchers.delete(fsPath);
  }

  onFileChange(workspaceFolder: URI, listener: WorkspaceWatcherEventListener): void {
    this.getWatcher(workspaceFolder)?.onFileChange(listener);
  }

  async getWatchedFiles(workspaceFolder: URI): Promise<URI[]> {
    return (await this.getWatcher(workspaceFolder)?.getWatchedFiles()) ?? [];
  }

  getStatus(workspaceFolder: URI) {
    return this.getWatcher(workspaceFolder)?.status;
  }
}

export { WorkspaceWatcherProvider, WorkspaceWatcher };
