import SHA256 from 'crypto-js/sha256.js';
import { LRUCacheMap } from '../../../../common/cache.ts';
import type { DocumentChunk, ChunkId, Chunk } from './IndexingTypes.ts';
type FilePath = string;

// const hash = (content: string) => SHA256(content).toString();
const hash = (content: string) => SHA256(content).toString(); // .slice(0, 6);

type HashString = string;

class WorkspaceChunks {
  private _chunks = new LRUCacheMap<ChunkId, Chunk>(50_000);
  private fileChunksIds = new LRUCacheMap<FilePath, ChunkId[]>(5000);
  private reverseChunks = new LRUCacheMap<HashString, ChunkId>(50_000);

  get chunks(): LRUCacheMap<ChunkId, Chunk> {
    return this._chunks;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  getChunk(id: ChunkId): Chunk | undefined {
    return this.chunks.get(id);
  }

  chunksForFile(filepath: FilePath): Chunk[] {
    const ids = this.fileChunksIds.get(filepath) || [];
    return ids.length ? ids.map((id) => this.chunks.get(id)).filter((chunk) => chunk !== undefined) : [];
  }

  chunkId(chunk: Chunk): ChunkId | undefined {
    const key = hash(chunk);
    return this.reverseChunks.get(key);
  }

  addChunks(chunks: DocumentChunk[]): void {
    for (let chunk of chunks) {
      this.chunks.set(chunk.id, chunk.chunk);
      const reverseKey = hash(chunk.chunk);
      this.reverseChunks.set(reverseKey, chunk.id);
    }
  }

  addChunksForFile(filepath: FilePath, chunks: DocumentChunk[]): void {
    let ids = chunks.map((chunk) => chunk.id);
    this.fileChunksIds.set(filepath, ids);
    this.addChunks(chunks);
  }

  deleteChunks(ids: ChunkId[]): void {
    for (let id of ids) {
      let chunk = this.chunks.get(id);
      if (chunk !== undefined) {
        this.chunks.delete(id);
        let reverseKey = hash(chunk);
        this.reverseChunks.delete(reverseKey);
      }
    }
  }

  deleteSubfolderChunks(subfolder: string): ChunkId[] {
    let subfolderFiles = [...this.fileChunksIds.keys()].filter((key) => key.startsWith(subfolder));
    let chunksIds: ChunkId[] = [];
    for (let file of subfolderFiles) {
      let fileChunkIds = this.fileChunksIds.get(file) || [];
      chunksIds.push(...fileChunkIds);
      this.fileChunksIds.delete(file);
    }
    this.deleteChunks(chunksIds);
    return chunksIds;
  }

  deleteFileChunks(filepath: FilePath): ChunkId[] {
    let chunkIds = this.fileChunksIds.get(filepath) || [];
    if (chunkIds.length > 0) {
      this.deleteChunks(chunkIds);
      this.fileChunksIds.delete(filepath);
    }
    return chunkIds;
  }
  clear() {
    this.chunks.clear();
    this.reverseChunks.clear();
    this.fileChunksIds.clear();
  }
}

export { WorkspaceChunks };
