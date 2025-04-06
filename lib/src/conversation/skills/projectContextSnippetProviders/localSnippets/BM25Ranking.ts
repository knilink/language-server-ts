import type { Context } from '../../../../context.ts';
import type { IRanking, RankingAlgorithmStatus, DocumentChunk } from './IndexingTypes.ts';

import * as microjob from 'microjob';
import { ChunkingProvider } from './ChunkingProvider.ts';
import { startWorkerPool } from '../../ProjectContextSkill.ts';
import { asyncIterableMap } from '../../../../common/iterableHelpers.ts';
import type {} from './RankingProvider.ts';

async function calculateIDFValues(keywords: string[], chunks: AsyncIterable<string>): Promise<Record<string, number>> {
  const keywordsBuffer = new SharedArrayBuffer(keywords.length * Int32Array.BYTES_PER_ELEMENT);
  const keywordsArray = new Int32Array(keywordsBuffer);
  const jobs: Promise<void>[] = [];
  let chunksLength = 0;
  for await (const chunk of chunks) {
    chunksLength++;
    const job = microjob
      .job(({ snippet, keywords }) => keywords.map((keyword) => (snippet.includes(keyword) ? 1 : 0)), {
        data: { snippet: chunk, keywords },
      })
      .then((results) => {
        for (let i = 0; i < keywords.length; i++) {
          Atomics.add(keywordsArray, i, results[i]);
        }
      });
    jobs.push(job);
  }
  await Promise.all(jobs);
  const idfArray = new Int32Array(keywordsBuffer);
  const idfValues: Record<string, number> = {};
  for (let i = 0; i < keywords.length; i++) {
    idfValues[keywords[i]] = Math.log((chunksLength - idfArray[i] + 0.5) / (idfArray[i] + 0.5) + 1);
  }
  return idfValues;
}

async function calculateBM25Score<T extends { chunk: string; tokenCount: number }>(
  chunk: T,
  keywords: string[],
  avgTokenCount: number,
  idfValues: Record<string, number>
): Promise<T & { score: number }> {
  return {
    score: await microjob.job(
      ({ keywords, document, docLength, avgTokenCount, idfValues, k1, b }) => {
        let totalScore = 0;
        for (let keyword of keywords) {
          const idf = idfValues[keyword];
          const tf = (document.match(new RegExp(keyword, 'g')) || []).length;
          const numerator = idf * (tf * (k1 + 1));
          const denominator = tf + k1 * (1 - b + (b * docLength) / avgTokenCount);
          totalScore += numerator / denominator;
        }
        return totalScore;
      },
      {
        data: {
          document: chunk.chunk,
          docLength: chunk.tokenCount,
          keywords,
          avgTokenCount,
          idfValues,
          k1,
          b,
        },
      }
    ),
    ...chunk,
  };
}

const b = 0.75;
const k1 = 1.2;
const MAX_SNIPPET_COUNT = 47;

class BM25Ranking implements IRanking {
  chunksCount = 0;
  sumTokenCount = 0;
  status: RankingAlgorithmStatus = 'notStarted';

  constructor(
    readonly ctx: Context,
    readonly workspaceFolder: string
  ) {}

  get avgTokenCount() {
    return this.sumTokenCount / this.chunksCount;
  }

  async initialize(chunks: AsyncIterable<DocumentChunk>) {
    this.sumTokenCount = 0;
    this.chunksCount = 0;
    for await (const chunk of chunks) {
      this.sumTokenCount += chunk.tokenCount;
      this.chunksCount++;
    }
    this.status = 'completed';
  }

  async addChunks(chunks: AsyncIterable<DocumentChunk>) {
    for await (const chunk of chunks) {
      this.sumTokenCount += chunk.tokenCount;
      this.chunksCount++;
    }
  }

  async query(keywords: string[]) {
    const workerPoolToken = await startWorkerPool();
    try {
      return await this.doQuery(keywords);
    } finally {
      await workerPoolToken.stopWorkerPool();
    }
  }

  async doQuery(keywords: string[]) {
    const lowercaseKeywords = keywords.map((keyword) => keyword.toLowerCase());
    const idfValues = await this.calculateIDFValues(lowercaseKeywords);
    const countLimit = Math.min(10 * keywords.length, MAX_SNIPPET_COUNT);
    const limit = Math.min(countLimit, this.chunksCount);
    return await this.calculateBM25Scores(lowercaseKeywords, this.avgTokenCount, idfValues, limit);
  }

  async calculateIDFValues(keywords: string[]) {
    const workspaceChunks = this.ctx.get(ChunkingProvider).getChunks(this.workspaceFolder);

    const chunkDocuments = asyncIterableMap(workspaceChunks, async (chunk) => ({
      ...chunk,
      chunk: chunk.chunk.toLowerCase(),
    }));

    const chunks = asyncIterableMap(chunkDocuments, async (doc) => doc.chunk);
    return await calculateIDFValues(keywords, chunks);
  }

  async calculateBM25Scores(
    keywords: string[],
    avgTokenCount: number,
    idfValues: Record<string, number>,
    limit: number
  ): Promise<(DocumentChunk & { score: number })[]> {
    const workspaceChunks = this.ctx.get(ChunkingProvider).getChunks(this.workspaceFolder);
    const heap = new SimpleHeap<DocumentChunk & { score: number }>(limit);
    for await (const chunk of workspaceChunks) {
      const scoredDocument = await calculateBM25Score(
        { ...chunk, chunk: chunk.chunk.toLowerCase() },
        keywords,
        avgTokenCount,
        idfValues
      );
      heap.add({ ...scoredDocument, chunk: chunk.chunk });
    }
    return heap.toArray(0.75);
  }

  async deleteEmbeddings(chunks: DocumentChunk[]) {
    this.chunksCount -= chunks.length;
    this.sumTokenCount -= chunks.reduce((acc, chunk) => acc + chunk.tokenCount, 0);
  }

  async terminateRanking() {}
}

class SimpleHeap<T extends { score: number }> {
  store: T[] = [];

  constructor(
    readonly maxSize: number,
    public minScore = -1 / 0
  ) {}
  toArray(maxSpread?: number): T[] {
    if (this.store.length && typeof maxSpread == 'number') {
      const minScore = this.store.at(0)!.score * (1 - maxSpread);
      return this.store.filter((x) => x.score >= minScore);
    }
    return this.store;
  }
  add(value: T) {
    if (value.score <= this.minScore) {
      return;
    }
    const index = this.store.findIndex((entry) => entry.score < value.score);
    for (this.store.splice(index >= 0 ? index : this.store.length, 0, value); this.store.length > this.maxSize; ) {
      this.store.pop();
    }

    if (this.store.length === this.maxSize) {
      this.minScore = this.store.at(-1)?.score ?? this.minScore;
    }
  }
}

export { BM25Ranking };
