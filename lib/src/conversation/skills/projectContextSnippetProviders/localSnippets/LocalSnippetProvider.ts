import type { Snippet, TelemetryMeasurements } from '../../../../types.ts';
import type { TurnContext } from '../../../turnContext.ts';
import type { DocumentChunk } from './IndexingTypes.ts';
import type { Snippet as SnippetType } from './EmbeddingsReranker.ts';

import { dedent } from 'ts-dedent';
import { ChunkingProvider } from './ChunkingProvider.ts';
import { rerankSnippets } from './EmbeddingsReranker.ts';
import { RankingProvider } from './RankingProvider.ts';
import { parseUserQuery } from './UserQueryParser.ts';
import { conversationLogger } from '../../../logger.ts';
import { defaultCodesearchMeasurements } from '../../../telemetry.ts';
import { FileReader } from '../../../../fileReader.ts';
import { telemetryException } from '../../../../telemetry.ts';
import { LocationFactory } from '../../../../textDocument.ts';
import type {} from '../indexingStatus.ts';
import type {} from './ChunkingHandler.ts';

class LocalSnippetProviderError extends Error {
  readonly name = 'LocalSnippetProviderError';
  constructor(readonly cause: unknown) {
    super(String(cause));
  }
}

class LocalSnippetProvider implements Snippet.ISnippetProvider {
  readonly providerType = 'local';

  async snippetProviderStatus(
    turnContext: TurnContext,
    canInitialize: boolean = true
  ): Promise<Snippet.SnippetProviderStatus> {
    if (!turnContext.turn.workspaceFolder) return 'not_indexed';

    const ctx = turnContext.ctx;
    const chunkingProvider = ctx.get(ChunkingProvider);
    const chunkingStatus = chunkingProvider.status(turnContext.turn.workspaceFolder);
    const rankingProvider = ctx.get(RankingProvider);
    const rankingStatus = rankingProvider.status(ctx, turnContext.turn.workspaceFolder);
    if (chunkingStatus === 'completed' && rankingStatus === 'completed') {
      return Promise.resolve('indexed');
    }
    if (chunkingStatus === 'started' || rankingStatus === 'started') {
      return Promise.resolve('indexing');
    }
    if (canInitialize) {
      const workspaceFolder = turnContext.turn.workspaceFolder;
      if (chunkingStatus === 'notStarted') {
        return Promise.race<Snippet.SnippetProviderStatus>([
          chunkingProvider
            .chunk(ctx, workspaceFolder)
            .then((chunks) => {
              if (chunkingProvider.status(workspaceFolder) === 'completed') {
                return rankingProvider.initialize(ctx, workspaceFolder, chunks);
              }
            })
            .then(() => this.snippetProviderStatus(turnContext, false)),
          new Promise((resolve) => setTimeout(() => resolve('not_indexed'), 1000)),
        ]);
      }
      if (rankingStatus === 'notStarted') {
        const chunks = chunkingProvider.getChunks(workspaceFolder);
        return Promise.race<Snippet.SnippetProviderStatus>([
          rankingProvider
            .initialize(ctx, workspaceFolder, chunks)
            .then(() => this.snippetProviderStatus(turnContext, false)),
          new Promise((resolve) => setTimeout(() => resolve('not_indexed'), 1e3)),
        ]);
      }
    }
    return Promise.resolve('not_indexed');
  }

  async collectLocalSnippets(turnContext: TurnContext, measurements: TelemetryMeasurements): Promise<DocumentChunk[]> {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) return [];
    const ctx = turnContext.ctx;
    const chunkCount = await ctx.get(ChunkingProvider).chunkCount(workspaceFolder);
    if (chunkCount === 0) {
      return [];
    }
    measurements.chunkCount = chunkCount;
    let keywords;
    const synonymsStart = performance.now();
    try {
      keywords = await parseUserQuery(turnContext, turnContext.cancelationToken);
    } catch (e) {
      const error = new LocalSnippetProviderError(e);
      telemetryException(ctx, error, 'LocalSnippetProvider.parseUserQuery');
    }
    const synonymsEnd = performance.now();
    measurements.synonymTimeMs = Math.floor(synonymsEnd - synonymsStart);

    if (keywords === undefined) return [];
    const rankingProvider = ctx.get(RankingProvider);
    let documentChunks: DocumentChunk[] = [];
    const rankingStart = performance.now();
    try {
      const snippets = await rankingProvider.query(ctx, workspaceFolder, keywords);
      measurements.localSnippetCount = snippets.length;
      documentChunks = snippets;
    } catch (e) {
      const error = new LocalSnippetProviderError(e);
      telemetryException(ctx, error, 'LocalSnippetProvider.rankingQuery');
    }
    const rankingEnd = performance.now();
    measurements.rankingTimeMs = Math.floor(rankingEnd - rankingStart);
    return documentChunks;
  }

  async rerankLocalSnippets(
    turnContext: TurnContext,
    snippets: SnippetType[],
    measurements: TelemetryMeasurements
  ): Promise<Snippet.Snippet[]> {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) return [];
    const ctx = turnContext.ctx;
    const userQuery = turnContext.turn.request.message;
    let snippetIds: string[] = [];
    try {
      snippetIds = await rerankSnippets(
        ctx,
        workspaceFolder,
        userQuery,
        snippets,
        5,
        turnContext.cancelationToken,
        measurements
      );
    } catch (e) {
      const error = new LocalSnippetProviderError(e);
      telemetryException(ctx, error, 'LocalSnippetProvider.rerankSnippets');
    }
    const projectContext = [];
    const fileReader = ctx.get(FileReader);
    for (const snippetId of snippetIds) {
      const filepath = snippetId.split('#')[0];
      const file = await fileReader.readFile(filepath);
      const snippet = snippets.find((s) => s.id === snippetId)!;
      if (file.status === 'valid') {
        const start = file.document.positionAt(snippet.range.start);
        const end = file.document.positionAt(snippet.range.end);
        const range = LocationFactory.range(start, end);
        projectContext.push({ uri: file.document.uri, range, snippet: snippet.chunk });
      }
    }
    return projectContext;
  }

  async provideSnippets(
    turnContext: TurnContext
  ): Promise<{ snippets: Snippet.Snippet[]; measurements: Snippet.Measurement }> {
    const message = this.collectInfoMessage(turnContext);

    if (message) {
      await turnContext.info(message);
    }

    const measurements = { ...defaultCodesearchMeasurements };
    const snippets = await this.collectLocalSnippets(turnContext, measurements);

    if (snippets.length === 0) {
      return { snippets: [], measurements };
    }
    const ctx = turnContext.ctx;
    conversationLogger.debug(ctx, `LocalSnippetProvider: First pass: Found ${snippets.length} snippets.`);
    return { snippets: await this.rerankLocalSnippets(turnContext, snippets, measurements), measurements };
  }

  collectInfoMessage(turnContext: TurnContext): string | undefined {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) {
      return;
    }
    const limits = turnContext.ctx.get(ChunkingProvider).checkLimits(workspaceFolder);
    if (limits.fileCountExceeded || limits.chunkCountExceeded) {
      return dedent`
Copilot has partially indexed this project as it exceeds the file limit. As a result, responses may have incomplete context. Consider excluding large, less relevant files or folders (e.g., large CSV files) to improve accuracy.
`;
    }
  }
}

export { LocalSnippetProvider, LocalSnippetProviderError };
