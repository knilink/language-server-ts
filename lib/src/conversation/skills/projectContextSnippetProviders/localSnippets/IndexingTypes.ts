import { Model } from '../../../../types.ts';
import { type TextDocument } from 'vscode-languageserver-textdocument';

interface IScoring {
  score(vector1: number[], vector2: number[]): number;
  terminateScoring(): void;
}

type RankingAlgorithmStatus = 'notStarted' | 'started' | 'completed';
// string because hash(chunk) in ./WorkspaceChunks.ts
type Chunk = string;
type ChunkId = string;

// named DocumentChunk because ./ChunkingHandler.ts const docChunks =
type DocumentChunk = { id: ChunkId; chunk: Chunk; tokenCount: number; range: { start: number; end: number } };
type ScoredDocumentChunk = DocumentChunk & { score: number };

interface IRanking<T = DocumentChunk> {
  initialize(chunks: AsyncIterable<T>): Promise<void>;
  get status(): RankingAlgorithmStatus;
  addChunks(chunks: AsyncIterable<T>): Promise<void>;
  deleteEmbeddings(chunks: T[]): Promise<void>;
  terminateRanking(): Promise<void>;
  query(userQueries: string[]): Promise<T[]>;
}

// ./ChunkingHandler.ts
interface IChunking {
  chunk(
    // TextDocument ./FixedSizeChunking.ts
    doc: TextDocument,
    modelConfig: Model.Configuration
  ): Promise<DocumentChunk[]>;
}

export { RankingAlgorithmStatus, Chunk, ChunkId, IScoring, IRanking, IChunking, DocumentChunk, ScoredDocumentChunk };
