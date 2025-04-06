import type { WorkspaceFolder } from 'vscode-languageserver-types';
import type { Context } from '../../../../context.ts';
import type { ChunkingAlgorithmType } from './ChunkingAlgorithms.ts';
import type { ChunkId, DocumentChunk } from './IndexingTypes.ts';
import type { CopilotTextDocument } from '../../../../textDocument.ts';

import { getChunkingAlgorithm } from './ChunkingAlgorithms.ts';
import { ChunkingHandler } from './ChunkingHandler.ts';
import { TelemetryData, telemetry } from '../../../../telemetry.ts';

class ChunkingProvider {
  private readonly ctx: Context;
  private readonly workspaceChunkingProviders: Map<string, ChunkingHandler>;

  constructor(ctx: Context) {
    this.ctx = ctx;
    this.workspaceChunkingProviders = new Map();
  }

  get workspaceCount(): number {
    return this.workspaceChunkingProviders.size;
  }

  createImplementation(workspaceFolder: string, type: ChunkingAlgorithmType): ChunkingHandler {
    const algorithmCtor = getChunkingAlgorithm(type);
    const implementation = new algorithmCtor();
    return new ChunkingHandler(this.ctx, workspaceFolder, implementation);
  }

  getImplementation(workspaceFolder: string, type: ChunkingAlgorithmType = 'default'): ChunkingHandler {
    const parentFolder = this.getParentFolder(workspaceFolder);
    if (parentFolder) {
      return this.workspaceChunkingProviders.get(parentFolder)!;
    }

    let provider = this.workspaceChunkingProviders.get(workspaceFolder);

    if (!provider) {
      provider = this.createImplementation(workspaceFolder, type);
      this.workspaceChunkingProviders.set(workspaceFolder, provider);
    }

    return provider;
  }

  getParentFolder(workspaceFolder: string): string | undefined {
    return [...this.workspaceChunkingProviders.keys()].find((folder) => {
      const parentFolder = folder.replace(/[#?].*/, '').replace(/\/?$/, '/');
      return workspaceFolder !== folder && workspaceFolder.startsWith(parentFolder);
    });
  }

  status(workspaceFolder: string): string {
    return this.getImplementation(workspaceFolder).status;
  }

  checkLimits(workspaceFolder: string): { fileCountExceeded: boolean; chunkCountExceeded: boolean } {
    const impl = this.getImplementation(workspaceFolder);
    return {
      fileCountExceeded: impl.fileCountExceeded,
      chunkCountExceeded: impl.chunkCountExceeded,
    };
  }

  async fileCount(workspaceFolder: string): Promise<number> {
    return this.getImplementation(workspaceFolder).getFilesCount();
  }

  async chunkCount(workspaceFolder: string): Promise<number> {
    return this.getImplementation(workspaceFolder).getChunksCount();
  }

  chunkingTimeMs(workspaceFolder: string): number {
    return this.getImplementation(workspaceFolder).chunkingTimeMs;
  }

  getChunks(workspaceFolder: string): AsyncIterable<DocumentChunk> {
    return this.getImplementation(workspaceFolder).getChunks();
  }

  async terminateChunking(ctx: Context, workspaceFolder: string): Promise<void> {
    const impl = this.getImplementation(workspaceFolder);
    await impl.terminateChunking();
    const telemetryData = TelemetryData.createAndMarkAsIssued().extendedBy(undefined, {
      fileCount: impl.filesUpdatedCount,
    });
    telemetry(ctx, 'index.terminate', telemetryData);
    this.workspaceChunkingProviders.delete(workspaceFolder);
  }

  async clearChunks(ctx: Context, workspaceFolder: string): Promise<void> {
    await this.terminateChunking(ctx, workspaceFolder);
    await this.getImplementation(workspaceFolder).clearChunks();
  }

  async deleteSubfolderChunks(parentFolder: string, workspaceFolder: string): Promise<DocumentChunk[]> {
    return await this.getImplementation(parentFolder).deleteSubfolderChunks(workspaceFolder);
  }

  async deleteFileChunks(workspaceFolder: string, filepaths: string | string[]): Promise<DocumentChunk[]> {
    const impl = this.getImplementation(workspaceFolder);
    const chunks: DocumentChunk[] = [];

    if (!Array.isArray(filepaths)) {
      filepaths = [filepaths];
    }

    for (const filepath of filepaths) {
      chunks.push(...(await impl.deleteFileChunks(filepath)));
    }
    return chunks;
  }

  async chunk(
    ctx: Context,
    workspaceFolder: string,
    documentsOrType?: CopilotTextDocument[] | ChunkingAlgorithmType,
    type?: ChunkingAlgorithmType
  ): Promise<AsyncGenerator<DocumentChunk>> {
    let documents: CopilotTextDocument[] | undefined;

    if (documentsOrType) {
      if (Array.isArray(documentsOrType)) {
        documents = documentsOrType;
      } else {
        type = documentsOrType;
      }
    }

    if (!type) {
      type = 'default';
    }

    return documents
      ? await this.chunkFiles(ctx, workspaceFolder, documents, type)
      : await this.chunkFolder(ctx, workspaceFolder, type);
  }

  private async chunkFolder(
    ctx: Context,
    workspaceFolder: string,
    type: ChunkingAlgorithmType = 'default'
  ): Promise<AsyncGenerator<DocumentChunk>> {
    const impl = this.getImplementation(workspaceFolder, type);
    const chunks = await impl.chunk(ctx);
    const telemetryData = TelemetryData.createAndMarkAsIssued().extendedBy(undefined, {
      fileCount: impl.totalFileCount,
      chunkCount: await impl.getChunksCount(),
      timeTakenMs: impl.chunkingTimeMs,
      workspaceCount: this.workspaceCount,
    });
    telemetry(ctx, 'index.chunk', telemetryData);
    return chunks;
  }

  async chunkFiles(
    ctx: Context,
    workspaceFolder: string,
    documents: CopilotTextDocument[],
    type: ChunkingAlgorithmType = 'default'
  ): Promise<AsyncGenerator<DocumentChunk>> {
    return await this.getImplementation(workspaceFolder, type).chunk(ctx, documents);
  }
}

export { ChunkingProvider };
