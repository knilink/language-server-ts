import { Jhaystack, RankingStrategy, FullTextScoringStrategy } from 'jhaystack';
import { IScoring, IRanking, Chunk, ChunkId, RankingAlgorithmStatus } from "./IndexingTypes.ts";

class BM25Ranking implements IRanking<Chunk> {
  private _status: RankingAlgorithmStatus = 'notStarted';
  private instance = new Jhaystack({
    indexing: { enable: true, options: { ranker: RankingStrategy.BM25 } },
    limit: 10,
    fullTextScoringStrategy: FullTextScoringStrategy.FULLTEXT_COSINE,
  });

  get status(): RankingAlgorithmStatus {
    return this._status;
  }

  async initialize(chunks: Chunk[]): Promise<void> {
    this._status = 'started';
    this.instance.setDataset(chunks);
    this.instance.setIndexStrategy({ ranker: RankingStrategy.BM25 });
    this._status = 'completed';
  }

  addChunks(chunks: Chunk[]): void {
    chunks.forEach((chunk) => {
      this.instance.addItem(chunk);
    });
    this.instance.buildIndex();
  }

  async query(userQueries: string[]): Promise<Chunk[]> {
    const haystackQuery: Parameters<typeof this.instance.queryAsync>[0] = [];

    for (const query of userQueries) {
      const queryWords = query.split(' ');
      const nestedQuery: Parameters<typeof this.instance.queryAsync>[0] = [];

      for (const word of queryWords) {
        nestedQuery.push({ type: 'index', value: word });
        nestedQuery.push('OR');
      }

      nestedQuery.pop();
      haystackQuery.push(nestedQuery);
    }

    haystackQuery.pop();
    const limit = Math.min(10 * userQueries.length, 100);
    const queryResults = await this.instance.queryAsync(haystackQuery, { limit });
    return queryResults.map((item) => item.item) as unknown as Chunk[]; // MARK: should be the same type as `chunks` in `setDataset`, considered to be typing design issues of `jhaystack`
  }

  terminateRanking(): void {
    this.instance.terminate();
  }

  deleteEmbeddings(chunkIds: ChunkId[]): void {
    chunkIds.forEach((chunkId) => {
      this.instance.removeItem(chunkId);
    });
    this.instance.buildIndex();
  }
}

class BM25Scoring implements IScoring {
  private instance = new Jhaystack();

  score(vector1: number[], vector2: number[]): number {
    const cosineSimilarityStrategy = FullTextScoringStrategy.FULLTEXT_COSINE;
    return cosineSimilarityStrategy({ isUnitLength: true, vector: vector1 }, { isUnitLength: true, vector: vector2 });
  }

  terminateScoring(): void {
    this.instance.terminate();
  }
}

export { BM25Ranking, BM25Scoring };
