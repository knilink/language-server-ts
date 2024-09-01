import { LRUCacheMap } from "../../../../common/cache.ts";
import { Context } from "../../../../context.ts";
import { IRanking, Chunk, ChunkId } from "./IndexingTypes.ts";
import { getRankingAlgorithm } from "./RankingAlgorithms.ts";

class RankingProvider {
  private workspaceRankingProviders = new LRUCacheMap<string, IRanking>(25);

  createImplementation(ctx: Context, type: string): IRanking {
    const algorithmCtor = getRankingAlgorithm(type);
    return new algorithmCtor();
  }

  getImplementation(ctx: Context, workspaceFolder: string, type: string = 'default'): IRanking {
    let provider = this.workspaceRankingProviders.get(workspaceFolder);
    if (!provider) {
      provider = this.createImplementation(ctx, type);
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

  initialize(ctx: Context, workspaceFolder: string, chunks: Map<ChunkId, Chunk>, type: string = 'default'): void {
    this.getImplementation(ctx, workspaceFolder, type).initialize([...chunks.values()]);
  }

  addChunks(ctx: Context, workspaceFolder: string, chunks: Chunk[], type: string = 'default'): void {
    const impl = this.getImplementation(ctx, workspaceFolder, type);
    console.warn(`Ranking implementation for ${type}`);
    impl.addChunks(chunks);
  }

  query(
    ctx: Context,
    workspaceFolder: string,
    // string[] ./LocalSnippetProvider.ts
    queries: string[],
    type?: string
  ) {
    return this.getImplementation(ctx, workspaceFolder, type).query(queries);
  }

  terminateRanking(
    ctx: Context,
    workspaceFolder: string,
    // optional ../../ProjectContextSkill.ts
    type?: string
  ): void {
    this.getImplementation(ctx, workspaceFolder, type).terminateRanking();
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
