import { Context } from '../../../../context.ts';
import { CancellationToken } from '../../../../../../agent/src/cancellation.ts';
import { conversationLogger } from '../../../logger.ts';
import { ModelConfigurationProvider } from '../../../modelConfigurations.ts';
import { fetchEmbeddings } from './EmbeddingsFetcher.ts';
import { ChunkingProvider } from './ChunkingProvider.ts';
import { ScoringProvider } from './ScoringProvider.ts';
import { type ScoringAlgorithmType } from './ScoringAlgorithms.ts';

type Snippet = { id: string; text: string };
interface RerankingOptions {
  modelFamily: string;
  scoringType: ScoringAlgorithmType;
  dimensions: number | null;
}
const defaultRerankingOptions: RerankingOptions = {
  modelFamily: 'text-embedding-3-small',
  scoringType: 'default',
  dimensions: null,
};

interface EmbeddingInput {
  id: string;
  text: string;
}

interface NormalizedEmbedding {
  id: string;
  embedding: number[];
}

async function rerankSnippets(
  ctx: Context,
  workspaceFolder: string,
  userQuery: string,
  snippets: string[],
  limit: number,
  cancellationToken: CancellationToken,
  rerankingOptions: Partial<RerankingOptions> = defaultRerankingOptions
): Promise<Snippet[]> {
  const options = { ...defaultRerankingOptions, ...rerankingOptions };
  const inputs = formatEmbeddingsInput(ctx, workspaceFolder, userQuery, snippets);
  conversationLogger.debug(ctx, `EmbeddingsReranker: Reranking ${inputs.length} snippets (includes the user query)`);

  const modelConfiguration = await ctx
    .get(ModelConfigurationProvider)
    .getFirstMatchingEmbeddingModelConfiguration(options.modelFamily);

  if (!modelConfiguration) {
    throw new Error(`EmbeddingsReranker: Model configuration not found for ${options.modelFamily}`);
  }

  const embeddings = await fetchEmbeddings(ctx, modelConfiguration, inputs, cancellationToken);
  if (!embeddings || embeddings.length === 0) return [];

  const normalizedEmbeddings = embeddings.map((e) => ({
    id: e.id,
    embedding: truncateNormalizeEmbedding(e.embedding, options.dimensions),
  }));

  const userQueryIdx = normalizedEmbeddings.findIndex((embedding) => embedding.id === 'userQuery');
  if (userQueryIdx === -1) return [];

  const [userQueryEmbedding] = normalizedEmbeddings.splice(userQueryIdx, 1);
  if (cancellationToken.isCancellationRequested) return [];

  const subset = scoreEmbeddings(
    ctx,
    workspaceFolder,
    normalizedEmbeddings,
    userQueryEmbedding,
    options.scoringType!
  ).slice(0, limit);

  conversationLogger.debug(ctx, `EmbeddingsReranker: Returning ${subset.length} snippets`);
  return subset.map((score) => inputs.find((snippet) => snippet.id === score.id)!); // MARK ! should be fine as long as fetch cover all inputs
}

function formatEmbeddingsInput(
  ctx: Context,
  workspaceFolder: string,
  userQuery: string,
  snippets: string[]
): EmbeddingInput[] {
  const chunkingProvider = ctx.get(ChunkingProvider);
  const inputs = snippets
    .map((snippet) => {
      const id = chunkingProvider.chunkId(workspaceFolder, snippet);
      return id ? { id, text: snippet } : null;
    })
    .filter((snippet) => !!snippet);
  return [...inputs, { id: 'userQuery', text: userQuery }];
}

function scoreEmbeddings(
  ctx: Context,
  workspaceFolder: string,
  embeddings: NormalizedEmbedding[],
  userQueryEmbedding: NormalizedEmbedding,
  scoringType: ScoringAlgorithmType
): { id: string; score: number }[] {
  const scoringProvider = ctx.get(ScoringProvider);
  return embeddings
    .map((embedding) => ({
      id: embedding.id,
      score: scoringProvider.score(
        ctx,
        workspaceFolder,
        userQueryEmbedding.embedding,
        embedding.embedding,
        scoringType
      ),
    }))
    .sort((a, b) => b.score - a.score);
}

function truncateNormalizeEmbedding(embedding: number[], dimensions: number | null): number[] {
  let resized = embedding;
  if (dimensions === null) dimensions = embedding.length;

  if (embedding.length < dimensions!) {
    resized = embedding.concat(Array(dimensions! - embedding.length).fill(0));
  } else if (embedding.length > dimensions!) {
    resized = embedding.slice(0, dimensions!);
  }

  const magnitude = Math.sqrt(resized.reduce((mag, dimension) => mag + dimension * dimension, 0));
  return resized.map((dimension) => dimension / magnitude);
}

export { truncateNormalizeEmbedding, rerankSnippets };
