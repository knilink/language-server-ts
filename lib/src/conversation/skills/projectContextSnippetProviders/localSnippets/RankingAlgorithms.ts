import { BM25Ranking } from './BM25Ranking.ts';
import { IRanking } from './IndexingTypes.ts';

const defaultRanking = 'bm25';
const algorithms: Map<string, new () => IRanking> = new Map([['bm25', BM25Ranking]]);

function getRankingAlgorithm(type: string): new () => IRanking {
  const mappedType = type === 'default' ? defaultRanking : type;
  const implementation = algorithms.get(mappedType);
  if (!implementation) throw new Error(`Ranking constructor for type ${type} not found`);
  return implementation;
}

export { getRankingAlgorithm };
