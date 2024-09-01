import { FixedSizeChunking } from "./FixedSizeChunking.ts";
import { IChunking } from "./IndexingTypes.ts";

type ChunkingAlgorithmType = string;

// const defaultChunking = 'fixedSize';

const algorithms: Map<ChunkingAlgorithmType, new () => IChunking> = new Map([
  ['default', FixedSizeChunking],
  ['fixedSize', FixedSizeChunking],
]);

function getChunkingAlgorithm(type: ChunkingAlgorithmType): new () => IChunking {
  // const mappedType = type === 'default' ? defaultChunking : type;
  const implementation = algorithms.get(type);
  if (!implementation) throw new Error(`Chunking constructor for type ${type} not found`);
  return implementation;
}

export { getChunkingAlgorithm, ChunkingAlgorithmType };
