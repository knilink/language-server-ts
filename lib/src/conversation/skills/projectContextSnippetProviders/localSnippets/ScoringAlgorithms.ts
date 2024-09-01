import { IScoring } from "./IndexingTypes.ts";
import { BM25Scoring } from "./BM25Ranking.ts";

const defaultScoring = 'cosine';
const algorithms = new Map<string, new () => IScoring>([['cosine', BM25Scoring]]);

function getScoringAlgorithm(type: ScoringAlgorithmType): new () => IScoring {
  const mappedType = type === 'default' ? defaultScoring : type;
  const implementation = algorithms.get(mappedType);
  if (!implementation) throw new Error(`Scoring constructor for type ${type} not found`);
  return implementation;
}

type ScoringAlgorithmType = string;

export { getScoringAlgorithm, ScoringAlgorithmType };
