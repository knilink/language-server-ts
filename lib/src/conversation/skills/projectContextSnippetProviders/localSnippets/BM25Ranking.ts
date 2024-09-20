import { default as os } from 'os';
import microjob from 'microjob';
import { IRanking, RankingAlgorithmStatus, DocumentChunk } from './IndexingTypes.ts';
import { Context } from '../../../../context.ts';
import { ChunkingProvider } from './ChunkingProvider.ts';

async function startWorkerPool() {
  if (!workerPoolStarted) {
    await microjob.start({ maxWorkers: MAX_THREAD_COUNT });
    workerPoolStarted = true;
  }
}
async function stopWorkerPool() {
  if (workerPoolStarted) {
    await microjob.stop();
    workerPoolStarted = false;
  }
}
async function calculateIDFValues(keywords: string[], chunks: string[]): Promise<Record<string, number>> {
  await startWorkerPool();
  let keywordsBuffer = new SharedArrayBuffer(keywords.length * Int32Array.BYTES_PER_ELEMENT);
  let keywordsArray = new Int32Array(keywordsBuffer);
  let idfDocuments = chunks.map(
    (chunk) =>
      new Promise<void>(async (resolve) => {
        const result = await microjob.job(
          ({ snippet, keywords }) => keywords.map((keyword) => (snippet.includes(keyword) ? 1 : 0)),
          { data: { snippet: chunk, keywords: keywords } }
        );
        for (let i = 0; i < keywords.length; i++) Atomics.add(keywordsArray, i, result[i]);
        resolve();
      })
  );
  await Promise.all(idfDocuments);
  let idfArray = new Int32Array(keywordsBuffer);
  let idfValues: Record<string, number> = {};
  for (let i = 0; i < keywords.length; i++)
    idfValues[keywords[i]] = Math.log((chunks.length - idfArray[i] + 0.5) / (idfArray[i] + 0.5) + 1);
  return idfValues;
}
async function calculateBM25Scores<T extends { chunk: string; tokenCount: number }>(
  chunkDocuments: T[],
  keywords: string[],
  avgTokenCount: number,
  idfValues: Record<string, number>
): Promise<(T & { score: number })[]> {
  await startWorkerPool();

  const jobs = chunkDocuments.map(
    (document: T): Promise<T & { score: number }> =>
      new Promise(async (resolve) => {
        const score = await microjob.job(
          ({ keywords, document, docLength, avgTokenCount, idfValues, k1, b }) => {
            let totalScore = 0;
            for (let keyword of keywords) {
              let idf = idfValues[keyword];
              let tf = (document.match(new RegExp(keyword, 'g')) || []).length;
              let numerator = idf * (tf * (k1 + 1));
              let denominator = tf + k1 * (1 - b + (b * docLength) / avgTokenCount);
              totalScore += numerator / denominator;
            }
            return totalScore;
          },
          {
            data: {
              document: document.chunk,
              docLength: document.tokenCount,
              keywords,
              avgTokenCount,
              idfValues,
              k1,
              b,
            },
          }
        );
        resolve({ score: score, ...document });
      })
  );

  const scored = await Promise.all(jobs);
  scored.sort((a, b) => b.score - a.score);
  await stopWorkerPool();
  return scored;
}

const b = 0.75;
const k1 = 1.2;
const MAX_SNIPPET_COUNT = 47;
const MAX_THREAD_COUNT = Math.max(os.cpus().length - 1, 1);
let workerPoolStarted = false;

class BM25Ranking implements IRanking<DocumentChunk> {
  avgTokenCount = 0;
  status: RankingAlgorithmStatus = 'notStarted';
  constructor(
    readonly ctx: Context,
    readonly workspaceFolder: string
  ) {}

  async initialize(chunks: DocumentChunk[]): Promise<void> {
    this.avgTokenCount = chunks.reduce((acc, chunk) => acc + chunk.tokenCount, 0) / chunks.length;
    this.status = 'completed';
    return Promise.resolve();
  }

  addChunks(): void {
    const allChunks = this.ctx.get(ChunkingProvider).getChunks(this.workspaceFolder);
    this.avgTokenCount = [...allChunks.values()].reduce((acc, chunk) => acc + chunk.tokenCount, 0) / allChunks.size;
  }

  async query(keywords: string[]): Promise<DocumentChunk[]> {
    const workspaceChunks = this.ctx.get(ChunkingProvider).getChunks(this.workspaceFolder);
    const lowercaseKeywords = keywords.map((keyword) => keyword.toLowerCase());
    const chunkDocuments: DocumentChunk[] = [];
    for (let chunk of workspaceChunks.values()) chunkDocuments.push({ ...chunk, chunk: chunk.chunk.toLowerCase() });
    const chunks = chunkDocuments.map((doc) => doc.chunk);
    const idfValues = await calculateIDFValues(lowercaseKeywords, chunks);
    const scored = await calculateBM25Scores(chunkDocuments, lowercaseKeywords, this.avgTokenCount, idfValues);
    const countLimit = Math.min(10 * keywords.length, MAX_SNIPPET_COUNT);
    const limit = Math.min(countLimit, chunkDocuments.length);
    const results = scored.slice(0, limit);
    for (let result of results) result.chunk = workspaceChunks.get(result.id)!.chunk;
    return results;
  }

  deleteEmbeddings(): void {
    const allChunks = this.ctx.get(ChunkingProvider).getChunks(this.workspaceFolder);
    this.avgTokenCount = [...allChunks.values()].reduce((acc, chunk) => acc + chunk.tokenCount, 0) / allChunks.size;
  }
  terminateRanking() {}
}

export { BM25Ranking };
