import type { DocumentUri } from 'vscode-languageserver-types';
import type { Context } from '../../../../context.ts';
import type { IRanking, DocumentChunk } from './IndexingTypes.ts';

import { getRankingAlgorithm } from './RankingAlgorithms.ts';
import { LRUCacheMap } from '../../../../common/cache.ts';

class RankingProvider {
  private workspaceRankingProviders = new LRUCacheMap<string, IRanking>(25);

  createImplementation(ctx: Context, workspaceFolder: DocumentUri, type: string): IRanking {
    const algorithmCtor = getRankingAlgorithm(type);
    return new algorithmCtor(ctx, workspaceFolder);
  }

  getImplementation(ctx: Context, workspaceFolder: DocumentUri, type: string = 'default'): IRanking {
    let provider = this.workspaceRankingProviders.get(workspaceFolder);

    if (!provider) {
      provider = this.createImplementation(ctx, workspaceFolder, type);
      this.workspaceRankingProviders.set(workspaceFolder, provider);
    }

    return provider;
  }

  status(
    ctx: Context,
    workspaceFolder: string,
    // optional ./LocalSnippetProvider.ts
    type?: string
  ) {
    return this.getImplementation(ctx, workspaceFolder, type).status;
  }

  async initialize(
    ctx: Context,
    workspaceFolder: DocumentUri,
    chunks: AsyncIterable<DocumentChunk>,
    type: string = 'default'
  ): Promise<void> {
    await this.getImplementation(ctx, workspaceFolder, type).initialize(chunks);
  }

  async addChunks(
    ctx: Context,
    workspaceFolder: DocumentUri,
    chunks: AsyncIterable<DocumentChunk>,
    type: string = 'default'
  ): Promise<void> {
    await this.getImplementation(ctx, workspaceFolder, type).addChunks(chunks);
  }

  async query(
    ctx: Context,
    workspaceFolder: string,
    // string[] ./LocalSnippetProvider.ts
    queries: string[],
    type?: string
  ) {
    return this.getImplementation(ctx, workspaceFolder, type).query(queries);
  }

  async terminateRanking(
    ctx: Context,
    workspaceFolder: string,
    // optional ../../ProjectContextSkill.ts
    type?: string
  ): Promise<void> {
    await this.getImplementation(ctx, workspaceFolder, type).terminateRanking();
    this.workspaceRankingProviders.delete(workspaceFolder);
  }

  async deleteEmbeddings(
    ctx: Context,
    workspaceFolder: string,
    chunks: DocumentChunk[],
    // optional ../../ProjectContextSkill.ts
    type?: string
  ): Promise<void> {
    return this.getImplementation(ctx, workspaceFolder, type).deleteEmbeddings(chunks);
  }
}

export { RankingProvider };
