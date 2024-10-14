import SHA256 from 'crypto-js/sha256.js';
import { LRUCacheMap } from '../../../../common/cache.ts';
import type { DocumentChunk, ChunkId } from './IndexingTypes.ts';
import { DocumentUri } from 'vscode-languageserver-types';
type FilePath = string;

// const hash = (content: string) => SHA256(content).toString();
const hash = (content: string) => SHA256(content).toString(); // .slice(0, 6);

type HashString = string;

const MAX_CHUNK_COUNT = 50_000;

class WorkspaceChunks {
  readonly _chunks = new LRUCacheMap<ChunkId, DocumentChunk>(MAX_CHUNK_COUNT);
  readonly fileChunksIds = new LRUCacheMap<FilePath, ChunkId[]>(5000);
  readonly reverseChunks = new LRUCacheMap<HashString, ChunkId>(MAX_CHUNK_COUNT);
  _totalChunkCount = 0;

  get fileCount(): number {
    return this.fileChunksIds.size;
  }

  get chunks(): LRUCacheMap<ChunkId, DocumentChunk> {
    return this._chunks;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  get totalChunkCount(): number {
    return this._totalChunkCount;
  }

  getChunk(id: ChunkId): DocumentChunk | undefined {
    return this.chunks.get(id);
  }

  chunksForFile({ uri }: { uri: DocumentUri }): DocumentChunk[] {
    const ids = this.fileChunksIds.get(uri) || [];
    return ids.length ? ids.map((id) => this.chunks.get(id)).filter((chunk) => chunk !== undefined) : [];
  }

  chunkId(chunk: string): ChunkId | undefined {
    const key = hash(chunk);
    return this.reverseChunks.get(key);
  }

  addChunks(chunks: DocumentChunk[]): void {
    for (let chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      const reverseKey = hash(chunk.chunk);
      this.reverseChunks.set(reverseKey, chunk.id);
    }
  }

  addChunksForFile({ uri }: { uri: DocumentUri }, chunks: DocumentChunk[]): void {
    let ids = chunks.map((chunk) => chunk.id);
    this.fileChunksIds.set(uri, ids);
    this.addChunks(chunks);
    this._totalChunkCount += chunks.length;
  }

  deleteChunks(ids: ChunkId[]): void {
    for (let id of ids) {
      let chunk = this.chunks.get(id);
      if (chunk !== undefined) {
        this.chunks.delete(id);
        let reverseKey = hash(chunk.chunk);
        this.reverseChunks.delete(reverseKey);
      }
    }
  }

  deleteSubfolderChunks({ uri }: { uri: DocumentUri }): ChunkId[] {
    let subfolderFiles = [...this.fileChunksIds.keys()].filter((key) => key.startsWith(uri));
    let chunksIds: ChunkId[] = [];
    for (let file of subfolderFiles) {
      let fileChunkIds = this.fileChunksIds.get(file) || [];
      chunksIds.push(...fileChunkIds);
      this.fileChunksIds.delete(file);
    }
    this.deleteChunks(chunksIds);
    return chunksIds;
  }

  deleteFileChunks({ uri }: { uri: DocumentUri }): ChunkId[] {
    let chunkIds = this.fileChunksIds.get(uri) || [];
    if (chunkIds.length > 0) {
      this.deleteChunks(chunkIds);
      this.fileChunksIds.delete(uri);
    }
    return chunkIds;
  }
  clear() {
    this.chunks.clear();
    this.reverseChunks.clear();
    this.fileChunksIds.clear();
  }
}

export { MAX_CHUNK_COUNT, WorkspaceChunks };
