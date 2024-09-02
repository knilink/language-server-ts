import { URI } from 'vscode-uri';
import { Context } from '../../../../context.ts';
import { getChunkingAlgorithm, ChunkingAlgorithmType } from './ChunkingAlgorithms.ts';
import { LRUCacheMap } from '../../../../common/cache.ts';
import { ChunkingHandler } from './ChunkingHandler.ts';
import { Chunk, ChunkId } from './IndexingTypes.ts';

class ChunkingProvider {
  private workspaceChunkingProviders = new LRUCacheMap<string, ChunkingHandler>(25);

  createImplementation(type: ChunkingAlgorithmType): ChunkingHandler {
    const algorithmCtor = getChunkingAlgorithm(type);
    const implementation = new algorithmCtor();
    return new ChunkingHandler(implementation);
  }

  getImplementation(workspaceFolder: string, type: ChunkingAlgorithmType = 'default'): ChunkingHandler {
    let provider = this.workspaceChunkingProviders.get(workspaceFolder);
    if (!provider) {
      provider = this.createImplementation(type);
      this.workspaceChunkingProviders.set(workspaceFolder, provider);
    }
    return provider;
  }

  getParentFolder(workspaceFolder: string): string | undefined {
    const folders = [...this.workspaceChunkingProviders.keys()];
    return folders.find((folder) => workspaceFolder.toLowerCase().startsWith(folder.toLowerCase()));
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

  chunkId(workspaceFolder: string, chunk: Chunk): ChunkId | undefined {
    return this.getImplementation(workspaceFolder).chunkId(chunk);
  }

  terminateChunking(workspaceFolder: string): void {
    this.getImplementation(workspaceFolder).terminateChunking();
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

  isMarkedForDeletion(workspaceFolder: string): boolean {
    return this.getImplementation(workspaceFolder).isMarkedForDeletion();
  }

  markForDeletion(workspaceFolder: string): void {
    this.getImplementation(workspaceFolder).markForDeletion();
  }

  cancelDeletion(workspaceFolder: string): void {
    this.getImplementation(workspaceFolder).cancelDeletion();
  }

  async chunk(
    ctx: Context,
    workspaceFolder: string,
    type: ChunkingAlgorithmType = 'default'
  ): Promise<LRUCacheMap<ChunkId, Chunk>> {
    return await this.getImplementation(workspaceFolder, type).chunk(ctx, workspaceFolder);
  }

  async chunkFiles(
    ctx: Context,
    workspaceFolder: string,
    filepath: { fsPath: string }[],
    type: ChunkingAlgorithmType = 'default'
  ): Promise<Chunk[]> {
    const impl = this.getImplementation(workspaceFolder, type);
    if (!Array.isArray(filepath)) {
      return await impl.chunkFile(ctx, filepath);
    }
    const chunks = [];
    for (const file of filepath) {
      chunks.push(...(await impl.chunkFile(ctx, file)));
    }
    return chunks;
  }
}

export { ChunkingProvider };
