import { Model } from '../../../../types';
import { TextDocument } from 'vscode-languageserver-textdocument';

interface IScoring {
  score(vector1: number[], vector2: number[]): number;
  terminateScoring(): void;
}

type RankingAlgorithmStatus = 'notStarted' | 'started' | 'completed';
// string because hash(chunk) in ./WorkspaceChunks.ts
type Chunk = string;
type ChunkId = string;

// named DocumentChunk because ./ChunkingHandler.ts const docChunks =
type DocumentChunk = { id: ChunkId; chunk: Chunk };

interface IRanking<T = Chunk> {
  initialize(chunks: T[]): Promise<void>;
  get status(): RankingAlgorithmStatus;
  addChunks(chunks: T[]): void;
  deleteEmbeddings(chunkIds: ChunkId[]): void;
  terminateRanking(): void;
  query(userQueries: string[]): Promise<T[]>;
}

// ./ChunkingHandler.ts
interface IChunking {
  chunk(doc: TextDocument, modelConfig: Model.Configuration): Promise<DocumentChunk[]>;
}

export { RankingAlgorithmStatus, Chunk, ChunkId, IScoring, IRanking, IChunking, DocumentChunk };
