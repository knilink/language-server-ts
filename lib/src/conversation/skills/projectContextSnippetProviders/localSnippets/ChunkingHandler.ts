import assert from 'node:assert';
import { URI } from 'vscode-uri';

import type { Model } from '../../../../types.ts';
import type { Chunk, ChunkId, DocumentChunk, IChunking } from './IndexingTypes.ts';
import { Context } from '../../../../context.ts';

import { MAX_CHUNK_COUNT, WorkspaceChunks } from './WorkspaceChunks.ts';
import { ModelConfigurationProvider } from '../../../modelConfigurations.ts';
import { getSupportedModelFamiliesForPrompt } from '../../../modelMetadata.ts';
import { telemetryException } from '../../../../telemetry.ts';
import { WorkspaceWatcherProvider } from '../../../../workspaceWatcherProvider.ts';
import { WatchedFilesError } from '../../../../workspaceWatcher.ts';
import { TextDocument } from '../../../../textDocument.ts';

class ChunkingError extends Error {
  readonly name = 'ChunkingError';
  constructor(message: string) {
    super(message);
  }
}

class ChunkingHandler {
  status: 'notStarted' | 'started' | 'cancelled' | 'completed' = 'notStarted';
  readonly workspaceChunks = new WorkspaceChunks();
  readonly cancellationToken = new ChunkingCancellationToken();
  _chunkingTimeMs = 0;
  modelConfig?: Model.Configuration;

  constructor(private implementation: IChunking) {}

  async chunk(ctx: Context, workspaceFolder: string): Promise<WorkspaceChunks['chunks']> {
    const chunkStart = performance.now();
    this.status = 'started';
    if (this.cancellationToken.isCancelled())
      return (
        (this.status = 'cancelled'), this.updateChunkingTime(chunkStart, performance.now()), this.workspaceChunks.chunks
      );
    await this.updateModelConfig(ctx);
    const watchedFiles = await ctx.get(WorkspaceWatcherProvider).getWatchedFiles(URI.file(workspaceFolder));
    if (watchedFiles instanceof WatchedFilesError)
      return (this.status = 'cancelled'), this.terminateChunking(), this.workspaceChunks.chunks;
    const promises = watchedFiles.map(async (document) => {
      if (!this.cancellationToken.isCancelled()) return this._chunk(ctx, document);
    });
    try {
      await Promise.all(promises);
    } catch (e) {
      let error = new ChunkingError((e as any).message);
      telemetryException(ctx, error, 'ChunkingProvider.chunk');
      this.terminateChunking();
    }
    this.status = this.cancellationToken.isCancelled() ? 'cancelled' : 'completed';
    this.updateChunkingTime(chunkStart, performance.now());
    this.checkChunkCount(ctx);
    return this.workspaceChunks.chunks;
  }

  async chunkFiles(ctx: Context, documents: TextDocument[]): Promise<DocumentChunk[]> {
    await this.updateModelConfig(ctx);
    let promises = documents.map(async (document) => {
      if (this.cancellationToken.isCancelled()) return [];
      await this._chunk(ctx, document);
      return this.workspaceChunks.chunksForFile(document.vscodeUri.fsPath);
    });
    let chunks: DocumentChunk[][] = [];
    try {
      chunks = await Promise.all(promises);
    } catch (e) {
      let error = new ChunkingError((e as any).message);
      telemetryException(ctx, error, 'ChunkingProvider.chunkFiles');
      this.terminateChunking();
    }
    this.checkChunkCount(ctx);
    return chunks.flat();
  }

  private async _chunk(ctx: Context, document: TextDocument): Promise<void> {
    if (this.cancellationToken.isCancelled()) return;
    assert(this.modelConfig);
    let docChunks = await this.implementation.chunk(document, this.modelConfig);
    this.workspaceChunks.addChunksForFile(document.vscodeUri.fsPath, docChunks);
  }

  private async updateModelConfig(ctx: Context): Promise<void> {
    if (!this.modelConfig) {
      this.modelConfig = await ctx
        .get(ModelConfigurationProvider)
        .getBestChatModelConfig(getSupportedModelFamiliesForPrompt('user'));
    }
  }

  terminateChunking(): void {
    this.cancellationToken.cancel();
    this.workspaceChunks.clear();
  }

  updateChunkingTime(start: number, end: number): void {
    this._chunkingTimeMs = end - start;
  }

  get chunkingTimeMs(): number {
    return this._chunkingTimeMs;
  }

  get fileCount(): number {
    return this.workspaceChunks.fileCount;
  }

  get chunks() {
    return this.workspaceChunks.chunks;
  }

  get chunkCount(): number {
    return this.workspaceChunks.chunkCount;
  }

  chunkId(chunk: Chunk): ChunkId | undefined {
    return this.workspaceChunks.chunkId(chunk);
  }

  deleteSubfolderChunks(subfolder: string): ChunkId[] {
    return this.workspaceChunks.deleteSubfolderChunks(subfolder);
  }

  deleteFileChunks(filepath: { fsPath: string }): ChunkId[] {
    return this.workspaceChunks.deleteFileChunks(filepath.fsPath);
  }

  checkChunkCount(ctx: Context): void {
    if (this.workspaceChunks.totalChunkCount > MAX_CHUNK_COUNT) {
      let error = new ChunkingError(
        `Chunk cache size exceeded, total chunk count: ${this.workspaceChunks.totalChunkCount}`
      );
      telemetryException(ctx, error, 'ChunkingHandler.chunk');
    }
  }
}

class ChunkingCancellationToken {
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }
}

export { ChunkingHandler, ChunkingCancellationToken, ChunkingError };
