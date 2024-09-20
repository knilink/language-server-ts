import { DocumentUri } from 'vscode-languageserver-types';
import { BM25Ranking } from './BM25Ranking.ts';
import { IRanking } from './IndexingTypes.ts';
import { Context } from '../../../../context.ts';

type AlgorithmCtor = new (ctx: Context, workspaceFolder: DocumentUri) => IRanking;

const defaultRanking = 'bm25';
const algorithms: Map<string, AlgorithmCtor> = new Map([['bm25', BM25Ranking]]);

function getRankingAlgorithm(type: string): AlgorithmCtor {
  const mappedType = type === 'default' ? defaultRanking : type;
  const implementation = algorithms.get(mappedType);
  if (!implementation) throw new Error(`Ranking constructor for type ${type} not found`);
  return implementation;
}

export { getRankingAlgorithm };
