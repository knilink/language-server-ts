import { URI } from 'vscode-uri';
import { Context } from '../../../../context.ts';
import { getChunkingAlgorithm, ChunkingAlgorithmType } from './ChunkingAlgorithms.ts';
import { LRUCacheMap } from '../../../../common/cache.ts';
import { ChunkingError, ChunkingHandler } from './ChunkingHandler.ts';
import { Chunk, ChunkId, DocumentChunk } from './IndexingTypes.ts';
import { telemetryException } from '../../../../telemetry.ts';
import { TextDocument } from '../../../../textDocument.ts';

const MAX_WORKSPACES = 25;
class ChunkingProvider {
  readonly workspaceChunkingProviders = new LRUCacheMap<string, ChunkingHandler>(MAX_WORKSPACES);
  workspaceCount = 0;

  createImplementation(type: ChunkingAlgorithmType): ChunkingHandler {
    const algorithmCtor = getChunkingAlgorithm(type);
    const implementation = new algorithmCtor();
    return new ChunkingHandler(implementation);
  }

  getImplementation(workspaceFolder: string, type: ChunkingAlgorithmType = 'default'): ChunkingHandler {
    const { fsPath } = workspaceFolder.startsWith('file://') ? URI.parse(workspaceFolder) : URI.file(workspaceFolder);
    const parentFolder = this.getParentFolder(workspaceFolder);
    if (parentFolder) return this.workspaceChunkingProviders.get(parentFolder)!;
    let provider = this.workspaceChunkingProviders.get(fsPath);

    if (!provider) {
      provider = this.createImplementation(type);
      this.workspaceChunkingProviders.set(fsPath, provider);
      this.workspaceCount++;
    }

    return provider;
  }

  getParentFolder(workspaceFolder: string): string | undefined {
    let fsPath = (
      workspaceFolder.startsWith('file://') ? URI.parse(workspaceFolder) : URI.file(workspaceFolder)
    ).fsPath.toLowerCase();
    for (const folder of this.workspaceChunkingProviders.keys()) {
      const lowercase = folder.toLowerCase();
      if (fsPath !== lowercase && fsPath.startsWith(lowercase)) {
        return folder;
      }
    }
  }

  isChunked(workspaceFolder: string): boolean {
    if (this.getImplementation(workspaceFolder).status !== 'notStarted') return true;
    const parentFolder = this.getParentFolder(workspaceFolder);
    return !!parentFolder && this.getImplementation(parentFolder).status !== 'notStarted';
  }

  status(workspaceFolder: string) {
    return this.getImplementation(workspaceFolder).status;
  }

  chunkCount(workspaceFolder: string) {
    return this.getImplementation(workspaceFolder).chunkCount;
  }

  fileCount(workspaceFolder: string) {
    return this.getImplementation(workspaceFolder).fileCount;
  }

  chunkId(workspaceFolder: string, chunk: Chunk): ChunkId | undefined {
    return this.getImplementation(workspaceFolder).chunkId(chunk);
  }

  chunkingTimeMs(workspaceFolder: string) {
    return this.getImplementation(workspaceFolder).chunkingTimeMs;
  }

  getChunks(workspaceFolder: string) {
    return this.getImplementation(workspaceFolder).chunks;
  }

  terminateChunking(workspaceFolder: string): void {
    this.getImplementation(workspaceFolder).terminateChunking();
    this.workspaceChunkingProviders.delete(workspaceFolder);
    this.workspaceCount--;
  }

  deleteSubfolderChunks(parentFolder: string, workspaceFolder: string): ChunkId[] {
    return this.getImplementation(parentFolder).deleteSubfolderChunks(workspaceFolder);
  }

  deleteFileChunks(workspaceFolder: string, filepaths: URI | URI[]): ChunkId[] {
    const impl = this.getImplementation(workspaceFolder);
    if (!Array.isArray(filepaths)) {
      return impl.deleteFileChunks(filepaths);
    }
    const chunkIds: ChunkId[] = [];
    for (const filepath of filepaths) {
      chunkIds.push(...impl.deleteFileChunks(filepath));
    }
    return chunkIds;
  }

  async chunk(
    ctx: Context,
    workspaceFolder: string,
    type: ChunkingAlgorithmType = 'default'
  ): Promise<LRUCacheMap<ChunkId, DocumentChunk>> {
    if (this.workspaceChunkingProviders.size === MAX_WORKSPACES) {
      let error = new ChunkingError(`Workspace cache size reached, total workspace count: ${this.workspaceCount}`);
      telemetryException(ctx, error, 'ChunkingProvider.chunk');
    }
    return this.getImplementation(workspaceFolder, type).chunk(ctx, workspaceFolder);
  }

  async chunkFiles(
    ctx: Context,
    workspaceFolder: string,
    documents: TextDocument[],
    type: ChunkingAlgorithmType = 'default'
  ): Promise<DocumentChunk[]> {
    return await this.getImplementation(workspaceFolder, type).chunkFiles(ctx, documents);
  }
}

export { ChunkingProvider };
