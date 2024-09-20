import { URI } from 'vscode-uri';
import { DocumentUri } from 'vscode-languageserver-types';
import { LRUCacheMap } from '../../../../common/cache.ts';
import { Context } from '../../../../context.ts';
import { IRanking, ChunkId, DocumentChunk } from './IndexingTypes.ts';
import { getRankingAlgorithm } from './RankingAlgorithms.ts';

class RankingProvider {
  private workspaceRankingProviders = new LRUCacheMap<string, IRanking>(25);

  createImplementation(ctx: Context, workspaceFolder: DocumentUri, type: string): IRanking {
    const algorithmCtor = getRankingAlgorithm(type);
    return new algorithmCtor(ctx, workspaceFolder);
  }

  getImplementation(ctx: Context, workspaceFolder: DocumentUri, type: string = 'default'): IRanking {
    const fsPath = (workspaceFolder.startsWith('file://') ? URI.parse(workspaceFolder) : URI.file(workspaceFolder))
      .fsPath;
    let provider = this.workspaceRankingProviders.get(fsPath);

    if (!provider) {
      provider = this.createImplementation(ctx, fsPath, type);
      this.workspaceRankingProviders.set(fsPath, provider);
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

  initialize(
    ctx: Context,
    workspaceFolder: DocumentUri,
    chunks: Map<ChunkId, DocumentChunk>,
    type: string = 'default'
  ): void {
    this.getImplementation(ctx, workspaceFolder, type).initialize([...chunks.values()]);
  }

  addChunks(ctx: Context, workspaceFolder: DocumentUri, chunks: DocumentChunk[], type: string = 'default'): void {
    this.getImplementation(ctx, workspaceFolder, type).addChunks(chunks);
  }

  async query(
    ctx: Context,
    workspaceFolder: string,
    // string[] ./LocalSnippetProvider.ts
    queries: string[],
    type?: string
  ) {
    const impl = this.getImplementation(ctx, workspaceFolder, type);
    const start = performance.now();
    const snippets = await impl.query(queries);
    const end = performance.now();
    return { snippets, rankingTimeMs: end - start };
  }

  terminateRanking(
    ctx: Context,
    workspaceFolder: string,
    // optional ../../ProjectContextSkill.ts
    type?: string
  ): void {
    this.getImplementation(ctx, workspaceFolder, type).terminateRanking();
    this.workspaceRankingProviders.delete(workspaceFolder);
  }

  deleteEmbeddings(
    ctx: Context,
    workspaceFolder: string,
    chunkIds: ChunkId[],
    // optional ../../ProjectContextSkill.ts
    type?: string
  ): void {
    this.getImplementation(ctx, workspaceFolder, type).deleteEmbeddings(chunkIds);
  }
}

export { RankingProvider };
