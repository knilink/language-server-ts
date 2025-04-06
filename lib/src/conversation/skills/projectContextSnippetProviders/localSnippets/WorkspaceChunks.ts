import * as fs from 'node:fs';
import { platform } from 'node:os';
import * as path from 'node:path';
import { env } from 'node:process';
import SHA256 from 'crypto-js/sha256.js';
import { URI } from 'vscode-uri';

import { Logger } from '../../../../logger.ts';
import { getFsPath } from '../../../../util/uri.ts';

import type { Context } from '../../../../context.ts';
import type { Chunk, DocumentChunk } from './IndexingTypes.ts';

function getXdgCachePath(): string {
  if (env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME)) {
    return env.XDG_CACHE_HOME + '/github-copilot';
  }
  if (platform() === 'win32') {
    return env.USERPROFILE + '\\AppData\\Local\\Temp\\github-copilot';
  }
  return env.HOME + '/.cache/github-copilot';
}

const MAX_CHUNK_COUNT = 50_000;

const logger = new Logger('workspaceChunks');

interface Cache {
  documentChunks: DocumentChunk[];
  hash: string;
  version: string;
}

class WorkspaceChunks {
  static CACHE_VERSION = '1.0.0';
  readonly pathHashLength = 8;
  readonly cacheRootPath: string;
  constructor(
    readonly ctx: Context,
    workspaceFolder: string
  ) {
    const workspaceName = path.basename(workspaceFolder);
    const workspaceHash = SHA256(workspaceFolder).toString().substring(0, this.pathHashLength);
    this.cacheRootPath = path.join(getXdgCachePath(), 'project-context', `${workspaceName}.${workspaceHash}`);
  }

  getChunksCacheFile(codeFilePath: string) {
    const key = SHA256(codeFilePath).toString().substring(0, this.pathHashLength);
    const fileName = path.basename(codeFilePath);
    return path.join(this.cacheRootPath, `${fileName}.${key}.json`);
  }

  async getChunksCacheFromCacheFile(cacheFile: string): Promise<Cache | undefined> {
    const raw = await fs.promises.readFile(cacheFile, { encoding: 'utf8' }).catch(() => {});
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
  }

  async getChunksCache(codeFilePathUri: string): Promise<Cache | undefined> {
    const cacheFile = this.getChunksCacheFile(codeFilePathUri);
    return await this.getChunksCacheFromCacheFile(cacheFile);
  }

  async setChunksCache(codeFilePathUri: string, cache: Cache | undefined) {
    const cacheFile = this.getChunksCacheFile(codeFilePathUri);
    try {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.promises.writeFile(cacheFile, JSON.stringify(cache), { encoding: 'utf8' });
    } catch (e) {
      logger.debug(this.ctx, 'Failed to set chunks cache:', e);
    }
  }

  async removeChunksCache(codeFilePathUri: string): Promise<void> {
    let cacheFile = this.getChunksCacheFile(codeFilePathUri);
    await fs.promises.rm(cacheFile).catch(() => {});
  }

  async enumerateChunksCacheFileNames(): Promise<string[]> {
    return await fs.promises.readdir(this.cacheRootPath).catch(() => []);
  }

  async getFilesCount(): Promise<number> {
    return (await this.enumerateChunksCacheFileNames()).length;
  }

  async getChunksCount(): Promise<number> {
    let count = 0;
    for await (const _ of this.getChunks()) count++;
    return count++; // TODO: count++ ???
  }

  async *getChunksForFile({ uri }: { uri: string }) {
    let cache = await this.getChunksCache(uri);

    if (cache !== undefined) {
      yield* cache.documentChunks;
    }
  }

  async *getChunksFromCacheFile(cacheFile: string): AsyncGenerator<DocumentChunk> {
    const cache = await this.getChunksCacheFromCacheFile(cacheFile);
    yield* cache ? cache.documentChunks : [];
  }

  async *getChunks(arg?: { uri: string }): AsyncGenerator<DocumentChunk> {
    if (arg !== undefined) {
      yield* this.getChunksForFile(arg);
    } else {
      let cacheFiles = await this.enumerateChunksCacheFileNames();
      for (let cacheFile of cacheFiles) yield* this.getChunksFromCacheFile(path.join(this.cacheRootPath, cacheFile));
    }
  }

  async getFileHash(codeFilePathUri: string) {
    let content = await fs.promises.readFile(URI.parse(codeFilePathUri).fsPath, { encoding: 'utf8' });
    return SHA256(content).toString();
  }

  async addChunks({ uri }: { uri: string }, chunks: DocumentChunk[]) {
    let fileHash = await this.getFileHash(uri);
    let existingChunks = await this.getChunksCache(uri);
    if (
      existingChunks !== undefined &&
      existingChunks.hash === fileHash &&
      existingChunks.version === WorkspaceChunks.CACHE_VERSION
    ) {
      return;
    }
    let cache = { version: WorkspaceChunks.CACHE_VERSION, filePath: uri, hash: fileHash, documentChunks: chunks };
    await this.setChunksCache(uri, cache);
  }

  async deleteChunksForSource(codeFilePath: string) {
    let codeFilePathUri = URI.file(codeFilePath).toString();
    let cache = await this.getChunksCache(codeFilePathUri);
    if (cache === undefined) {
      return [];
    }
    await this.removeChunksCache(codeFilePathUri);
    return cache.documentChunks;
  }

  async deleteChunks({ uri }: { uri: string }): Promise<DocumentChunk[]> {
    const codeFilePath = getFsPath(uri);
    if (!codeFilePath) {
      return [];
    }
    let files;
    try {
      files = await fs.promises.readdir(codeFilePath);
    } catch {
      return await this.deleteChunksForSource(codeFilePath);
    }
    const chunks: DocumentChunk[] = [];
    for (const file of files) {
      const subUri = URI.file(path.join(codeFilePath, file)).toString();
      chunks.push(...(await this.deleteChunks({ uri: subUri })));
    }
    return chunks;
  }

  async clear() {
    await fs.promises.rm(this.cacheRootPath, { recursive: true }).catch(() => {});
  }
}

export { MAX_CHUNK_COUNT, WorkspaceChunks };
