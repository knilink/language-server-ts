import assert from 'node:assert';
import type { DocumentUri } from 'vscode-languageserver-types';
import type { Model } from '../../../../types.ts';
import type { Chunk, ChunkId, DocumentChunk, IChunking } from './IndexingTypes.ts';
import type { Context } from '../../../../context.ts';
import type { CopilotTextDocument } from '../../../../textDocument.ts';

import { MAX_CHUNK_COUNT, WorkspaceChunks } from './WorkspaceChunks.ts';
import { ModelConfigurationProvider } from '../../../modelConfigurations.ts';
import { getSupportedModelFamiliesForPrompt } from '../../../modelMetadata.ts';
import { asyncIterableConcat } from '../../../../common/iterableHelpers.ts';
import { Features } from '../../../../experiments/features.ts';
import { telemetryException } from '../../../../telemetry.ts';
import { WorkspaceWatcherProvider } from '../../../../workspaceWatcherProvider.ts';

class ChunkingHandler {
  _chunkLimiter = new Limiter();
  status: 'notStarted' | 'started' | 'cancelled' | 'completed' = 'notStarted';
  readonly workspaceChunks: WorkspaceChunks;
  readonly cancellationToken = new ChunkingCancellationToken();
  _chunkingTimeMs = 0;
  _fileCountExceeded = false;
  _chunkCountExceeded = false;
  _totalFileCount = 0;
  _filesUpdated = new Set();

  modelConfig?: Model.Configuration;

  constructor(
    readonly ctx: Context,
    readonly workspaceFolder: string,
    readonly implementation: IChunking
  ) {
    this.workspaceChunks = new WorkspaceChunks(ctx, workspaceFolder);
  }

  async chunk(ctx: Context, documents?: CopilotTextDocument[]): Promise<AsyncGenerator<DocumentChunk>> {
    return documents ? await this.chunkFiles(ctx, documents) : await this.chunkWorkspace(ctx);
  }

  async chunkWorkspace(ctx: Context): Promise<AsyncGenerator<DocumentChunk>> {
    const chunkStart = performance.now();
    this.status = 'started';
    if (this.cancellationToken.isCancelled()) {
      this.status = 'cancelled';
      this.updateChunkingTime(chunkStart, performance.now());
      return this.workspaceChunks.getChunks();
    }
    await this.updateModelConfig(ctx);
    let watchedFiles = await ctx.get(WorkspaceWatcherProvider).getWatchedFiles({ uri: this.workspaceFolder });
    const features = ctx.get(Features);
    const telemetryDataWithExp = await features.updateExPValuesAndAssignments();
    const threshold = features.ideChatProjectContextFileCountThreshold(telemetryDataWithExp);
    this._totalFileCount = watchedFiles.length;

    if (watchedFiles.length > threshold) {
      this._fileCountExceeded = true;
      watchedFiles = watchedFiles.slice(0, threshold);
    }

    const promises = watchedFiles.map(async (document) => {
      if (!this.cancellationToken.isCancelled()) {
        await this._chunkLimiter.queue(() => this._chunk(ctx, document));
      }
    });
    try {
      await Promise.all(promises);
    } catch (e) {
      telemetryException(ctx, e, 'ChunkingProvider.chunk');
      await this.terminateChunking();
    }
    this.status = this.cancellationToken.isCancelled() ? 'cancelled' : 'completed';
    this.updateChunkingTime(chunkStart, performance.now());

    if ((await this.workspaceChunks.getChunksCount()) > MAX_CHUNK_COUNT) {
      this._chunkCountExceeded = true;
    }

    return this.workspaceChunks.getChunks();
  }

  async chunkFiles(ctx: Context, documents: CopilotTextDocument[]): Promise<AsyncGenerator<DocumentChunk>> {
    await this.updateModelConfig(ctx);
    const promises = documents.map(async (document) => {
      if (!this.cancellationToken.isCancelled()) {
        this._filesUpdated.add(document.uri);
        await this._chunkLimiter.queue(() => this._chunk(ctx, document));
      }
    });
    try {
      await Promise.all(promises);
    } catch (e) {
      telemetryException(ctx, e, 'ChunkingProvider.chunkFiles');
      await this.terminateChunking();
    }

    if ((await this.workspaceChunks.getChunksCount()) > MAX_CHUNK_COUNT) {
      this._chunkCountExceeded = true;
    }

    const features = ctx.get(Features);
    const telemetryDataWithExp = await features.updateExPValuesAndAssignments();
    const fileCountThreshold = features.ideChatProjectContextFileCountThreshold(telemetryDataWithExp);

    if ((await this.workspaceChunks.getFilesCount()) > fileCountThreshold) {
      this._fileCountExceeded = true;
    }

    return asyncIterableConcat(...documents.map((document) => this.workspaceChunks.getChunks(document)));
  }

  async _chunk(ctx: Context, document: CopilotTextDocument): Promise<void> {
    if (this.cancellationToken.isCancelled()) return;
    assert(this.modelConfig);
    const docChunks = await this.implementation.chunk(document, this.modelConfig);
    await this.workspaceChunks.addChunks(document, docChunks);
  }

  async updateModelConfig(ctx: Context): Promise<void> {
    if (!this.modelConfig) {
      this.modelConfig = await ctx
        .get(ModelConfigurationProvider)
        .getBestChatModelConfig(getSupportedModelFamiliesForPrompt('user'));
    }
  }

  async terminateChunking(): Promise<void> {
    this.cancellationToken.cancel();
  }

  async clearChunks(): Promise<void> {
    await this.workspaceChunks.clear();
  }

  updateChunkingTime(start: number, end: number): void {
    this._chunkingTimeMs = end - start;
  }

  get chunkingTimeMs(): number {
    return Math.floor(this._chunkingTimeMs);
  }

  get fileCountExceeded(): boolean {
    return this._fileCountExceeded;
  }

  get totalFileCount(): number {
    return this._totalFileCount;
  }

  get chunkCountExceeded(): boolean {
    return this._chunkCountExceeded;
  }

  get filesUpdatedCount(): number {
    return this._filesUpdated.size;
  }

  async getFilesCount(): Promise<number> {
    return this.workspaceChunks.getFilesCount();
  }

  getChunks(): AsyncGenerator<DocumentChunk> {
    return this.workspaceChunks.getChunks();
  }

  async getChunksCount(): Promise<number> {
    return this.workspaceChunks.getChunksCount();
  }

  async deleteSubfolderChunks(uri: DocumentUri): Promise<DocumentChunk[]> {
    return this.workspaceChunks.deleteChunks({ uri });
  }

  async deleteFileChunks(uri: DocumentUri): Promise<DocumentChunk[]> {
    this._filesUpdated.add(uri);
    return this.workspaceChunks.deleteChunks({ uri });
  }
}

class ChunkingCancellationToken {
  cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }
}

type Task<T = any> = {
  factory: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
};

class Limiter {
  readonly tasks: Task[] = [];
  runningTasks: number = 0;

  constructor(readonly maxCount: number = 20) {}

  async queue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.tasks.push({ factory: task, resolve, reject });
      this.consume();
    });
  }

  consume(): void {
    while (this.tasks.length > 0 && this.runningTasks < this.maxCount) {
      const { factory, resolve, reject } = this.tasks.shift()!;
      this.runningTasks++;
      const promise = factory();
      promise.then(resolve, reject);
      promise.finally(() => this.consumed());
    }
  }

  consumed(): void {
    this.runningTasks--;
    this.consume();
  }
}

export { ChunkingHandler };
