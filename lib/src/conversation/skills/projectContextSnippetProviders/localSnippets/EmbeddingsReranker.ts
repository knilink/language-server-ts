import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { TelemetryMeasurements } from '../../../../types.ts';
import type { Context } from '../../../../context.ts';
import type { ScoringAlgorithmType } from './ScoringAlgorithms.ts';
import type { WorkspaceFolder } from 'vscode-languageserver-types';

import { fetchEmbeddings } from './EmbeddingsFetcher.ts';
import { ScoringProvider } from './ScoringProvider.ts';
import { conversationLogger } from '../../../logger.ts';
import { ModelConfigurationProvider } from '../../../modelConfigurations.ts';
import type {} from '../../../modelMetadata.ts';
import type {} from './ScoringAlgorithms.ts';

type Snippet = { id: string; chunk: string; range: { start: number; end: number } };

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
  snippets: Snippet[],
  limit: number,
  cancellationToken: CancellationToken,
  measurements: TelemetryMeasurements,
  rerankingOptions: Partial<RerankingOptions> = defaultRerankingOptions
): Promise<string[]> {
  const options = { ...defaultRerankingOptions, ...rerankingOptions };
  const inputs = formatEmbeddingsInput(ctx, workspaceFolder, userQuery, snippets);
  conversationLogger.debug(ctx, `EmbeddingsReranker: Reranking ${inputs.length} snippets (includes the user query)`);

  const modelConfiguration = await ctx
    .get(ModelConfigurationProvider)
    .getFirstMatchingEmbeddingModelConfiguration(options.modelFamily);

  if (!modelConfiguration) {
    throw new Error(`EmbeddingsReranker: Model configuration not found for ${options.modelFamily}`);
  }

  const embeddingsStart = performance.now();
  const embeddings = await fetchEmbeddings(ctx, modelConfiguration, inputs, cancellationToken);
  const embeddingsEnd = performance.now();
  measurements.embeddingsTimeMs = Math.floor(embeddingsEnd - embeddingsStart);

  if (!embeddings || embeddings.length === 0) return [];

  const userQueryIdx = embeddings.findIndex((embedding) => embedding.id === 'userQuery');

  if (userQueryIdx === -1) return [];

  const userQueryEmbedding = embeddings.splice(userQueryIdx, 1)[0];
  if (cancellationToken.isCancellationRequested) return [];

  const scoringStart = performance.now();
  const scores = scoreEmbeddings(ctx, workspaceFolder, embeddings, userQueryEmbedding, options.scoringType);
  const scoringEnd = performance.now();
  measurements.rerankingTimeMs = Math.floor(scoringEnd - scoringStart);
  const subset = scores.slice(0, limit);

  conversationLogger.debug(ctx, `EmbeddingsReranker: Returning ${subset.length} snippets`);
  return subset.map((score) => inputs.find((snippet) => snippet.id === score.id)!.id); // MARK ! should be fine as long as fetch cover all inputs
}

function formatEmbeddingsInput(
  ctx: Context,
  workspaceFolder: string,
  userQuery: string,
  snippets: Snippet[]
): EmbeddingInput[] {
  const inputs = snippets.map((snippet) => ({ id: snippet.id, text: snippet.chunk.toLowerCase() }));
  inputs.push({ id: 'userQuery', text: userQuery.toLowerCase() });
  return inputs;
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

export { rerankSnippets, Snippet };
