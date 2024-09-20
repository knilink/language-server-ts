import { URI } from 'vscode-uri';
import { type Context } from '../context.ts';
import { type GitRemoteUrl } from './gitRemoteUrl.ts';

import { FileSystem } from '../fileSystem.ts';
import { GitRemoteResolver } from './gitRemoteResolver.ts';
import { LRUCacheMap } from '../common/cache.ts';
import assert from 'assert';
import { dirname, joinPath, parseUri, resolveFilePath } from '../util/uri.ts';
import { DocumentUri } from 'vscode-languageserver-types';

const maxRepoCacheSize: number = 100;

class GitRepository {
  private _tenant?: string;
  private _owner?: string;
  private _name?: string;
  private _adoOrganization?: string;

  constructor(
    readonly baseFolder: URI,
    readonly remote?: GitRemoteUrl
  ) {
    this.setNWO();
  }

  get tenant(): string | undefined {
    return this._tenant;
  }

  get owner(): string | undefined {
    return this._owner;
  }

  get name(): string | undefined {
    return this._name;
  }

  get adoOrganization(): string | undefined {
    return this._adoOrganization;
  }

  isGitHub(): boolean {
    const remote = this.remote;
    return remote?.isGitHub() ?? false;
  }

  isADO(): boolean {
    const remote = this.remote;
    return remote?.isADO() ?? false;
  }

  setNWO(): void {
    const parts = this.remote?.path?.replace(/^\//, '').split('/');
    if (this.isGitHub()) {
      this._owner = parts?.[0];
      this._name = parts?.[1]?.replace(/\.git$/, '');
      const match = /^(?<tenant>[^.]+)\.ghe\.com$/.exec(this.remote?.hostname ?? '');
      if (match && match.groups) {
        this._tenant = match.groups.tenant;
      }
    } else if (this.isADO() && parts?.length === 4) {
      if (this.remote?.scheme === 'ssh') {
        this._adoOrganization = parts?.[1];
        this._owner = parts?.[2];
        this._name = parts?.[3];
        return;
      }
      const match = /(?:(?<org>[^.]+)\.)?visualstudio\.com$/.exec(this.remote?.hostname ?? '');
      if (match) {
        this._adoOrganization = match.groups?.org;
        this._owner = parts?.[1];
        this._name = parts?.[3];
      } else {
        this._adoOrganization = parts?.[0];
        this._owner = parts?.[1];
        this._name = parts?.[3];
      }
    }
  }
}

class RepositoryManager {
  readonly remoteResolver = new GitRemoteResolver();
  readonly cache = new LRUCacheMap<string, GitRepository | undefined>(maxRepoCacheSize);

  constructor(readonly ctx: Context) {}

  async getRepo(uri: URI | DocumentUri): Promise<GitRepository | undefined> {
    let lastFsPath: URI | DocumentUri | undefined;
    const testedPaths: string[] = [];
    const uriString = uri.toString();
    do {
      if (this.cache.has(uriString)) {
        const result = this.cache.get(uriString);
        this.updateCache(testedPaths, result);
        return result;
      }
      testedPaths.push(uriString);
      const repo = await this.tryGetRepoForFolder(uri);
      if (repo) {
        this.updateCache(testedPaths, repo);
        return repo;
      }
      lastFsPath = uri;
      uri = dirname(uri);
    } while (uri !== lastFsPath);
    this.updateCache(testedPaths, undefined); // MARK ??? not deleting
  }

  updateCache(paths: string[], repo?: GitRepository): void {
    paths.forEach((path) => this.cache.set(path, repo));
  }

  async tryGetRepoForFolder(uri: URI | DocumentUri): Promise<GitRepository | undefined> {
    if (await this.isBaseRepoFolder(uri)) {
      if (typeof uri === 'string') {
        uri = parseUri(uri, true);
      }
      return new GitRepository(uri, await this.repoUrl(uri));
    }
  }

  async isBaseRepoFolder(uri: URI | DocumentUri): Promise<boolean> {
    return (await RepositoryManager.getRepoConfigLocation(this.ctx, uri)) !== undefined;
  }

  async repoUrl(baseFolder: URI | DocumentUri): Promise<GitRemoteUrl | undefined> {
    return await this.remoteResolver.resolveRemote(this.ctx, baseFolder);
  }

  static async getRepoConfigLocation(ctx: Context, baseFolder: DocumentUri): Promise<DocumentUri | undefined>;
  static async getRepoConfigLocation(ctx: Context, baseFolder: URI): Promise<URI | undefined>;
  static async getRepoConfigLocation(
    ctx: Context,
    baseFolder: URI | DocumentUri
  ): Promise<URI | DocumentUri | undefined>;
  static async getRepoConfigLocation(
    ctx: Context,
    baseFolder: URI | DocumentUri
  ): Promise<URI | DocumentUri | undefined> {
    try {
      const fs = ctx.get(FileSystem);
      const gitDir = joinPath(baseFolder, '.git');
      if ((await fs.stat(gitDir)).type & 1) {
        return await RepositoryManager.getConfigLocationForGitfile(fs, baseFolder, gitDir);
      }
      const configPath = joinPath(gitDir, 'config');
      await fs.stat(configPath);
      return configPath;
    } catch {}
  }

  static async getConfigLocationForGitfile(
    fs: FileSystem,
    baseFolder: URI | DocumentUri,
    gitFile: URI | DocumentUri
  ): Promise<URI | DocumentUri | undefined> {
    const match = (await fs.readFileString(gitFile)).match(/^gitdir:\s+(.+)$/m);
    if (!match) return;
    let gitDir = resolveFilePath(baseFolder, match[1]);
    const configPath = joinPath(gitDir, 'config');
    if (await RepositoryManager.tryStat(fs, configPath)) {
      return configPath;
    }
    const worktreeConfigPath = joinPath(gitDir, 'config.worktree');
    if (await RepositoryManager.tryStat(fs, worktreeConfigPath)) {
      return worktreeConfigPath;
    }
    const commonDirPath = joinPath(gitDir, 'commondir');
    gitDir = resolveFilePath(gitDir, (await fs.readFileString(commonDirPath)).trimEnd());
    const commonConfigPath = joinPath(gitDir, 'config');
    await fs.stat(commonConfigPath);
    return commonConfigPath;
  }

  static async tryStat(fs: FileSystem, path: URI | DocumentUri) {
    try {
      return await fs.stat(path);
    } catch {}
  }
}

export { RepositoryManager };
