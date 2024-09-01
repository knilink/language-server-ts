import assert from 'node:assert';
import { URI } from 'vscode-uri';

import type { Model } from "../../../../types.ts";
import type { Chunk, ChunkId, IChunking } from "./IndexingTypes.ts";

import { Context } from "../../../../context.ts";
import { WorkspaceWatcherProvider } from "../../../../workspaceWatcherProvider.ts";
import { FileReader } from "../../../../fileReader.ts";
import { ModelConfigurationProvider } from "../../../modelConfigurations.ts";
import { getSupportedModelFamiliesForPrompt } from "../../../modelMetadata.ts";
import { WorkspaceChunks } from "./WorkspaceChunks.ts";

class ChunkingHandler {
  status: 'notStarted' | 'started' | 'cancelled' | 'completed' = 'notStarted';
  private workspaceChunks = new WorkspaceChunks();
  private cancellationToken = new ChunkingCancellationToken();
  private needsDeletion = false;
  private modelConfig?: Model.Configuration;

  constructor(private implementation: IChunking) { }

  async chunk(ctx: Context, workspaceFolder: string): Promise<WorkspaceChunks['chunks']> {
    this.status = 'started';
    if (this.cancellationToken.isCancelled()) {
      this.status = 'cancelled';
      return this.workspaceChunks.chunks;
    }
    await this.updateModelConfig(ctx);
    const promises: Promise<void>[] = (
      await ctx.get(WorkspaceWatcherProvider).getWatchedFiles(URI.file(workspaceFolder))
    ).map(async (fileUri) => {
      if (this.cancellationToken.isCancelled()) return;
      const filepath: string = fileUri.fsPath;
      await this._chunk(ctx, filepath);
    });
    await Promise.all(promises);
    this.status = this.cancellationToken.isCancelled() ? 'cancelled' : 'completed';
    return this.workspaceChunks.chunks;
  }

  async chunkFile(ctx: Context, fileUri: { fsPath: string }): Promise<Chunk[]> {
    await this.updateModelConfig(ctx);
    await this._chunk(ctx, fileUri.fsPath);
    return this.workspaceChunks.chunksForFile(fileUri.fsPath);
  }

  private async _chunk(ctx: Context, filepath: string): Promise<void> {
    if (this.cancellationToken.isCancelled()) return;
    const fileDoc = await ctx.get(FileReader).readFile(filepath);
    if (!this.cancellationToken.isCancelled() && fileDoc.status === 'valid') {
      assert(this.modelConfig);
      const docChunks = await this.implementation.chunk(fileDoc.document, this.modelConfig);
      this.workspaceChunks.addChunksForFile(filepath, docChunks);
    }
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

  markForDeletion(): void {
    this.needsDeletion = true;
  }

  cancelDeletion(): void {
    this.needsDeletion = false;
  }

  isMarkedForDeletion(): boolean {
    return this.needsDeletion;
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

export { ChunkingHandler, ChunkingCancellationToken };
