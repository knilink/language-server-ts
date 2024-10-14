import type { Snippet } from '../../../../types.ts';

import { type TurnContext } from '../../../turnContext.ts';

import { ChunkingProvider } from './ChunkingProvider.ts';
import { rerankSnippets, Snippet as SnippetType } from './EmbeddingsReranker.ts';
import { RankingProvider } from './RankingProvider.ts';
import { parseUserQuery } from './UserQueryParser.ts';
import { conversationLogger } from '../../../logger.ts';
import { FileReader } from '../../../../fileReader.ts';
import { telemetryException } from '../../../../telemetry.ts';
import { LocationFactory } from '../../../../textDocument.ts';
import { DocumentChunk } from './IndexingTypes.ts';

class LocalSnippetProviderError extends Error {
  readonly name = 'LocalSnippetProviderError';
  constructor(readonly cause: unknown) {
    super(String(cause));
  }
}

class LocalSnippetProvider implements Snippet.ISnippetProvider {
  readonly providerType = 'local';
  readonly rankingTimeHistory: Record<string, number> = {};

  async snippetProviderStatus(turnContext: TurnContext): Promise<Snippet.SnippetProviderStatus> {
    if (!turnContext.turn.workspaceFolder) return 'not_indexed';
    const ctx = turnContext.ctx;
    const chunkingStatus = ctx.get(ChunkingProvider).status(turnContext.turn.workspaceFolder);
    const rankingStatus = ctx.get(RankingProvider).status(ctx, turnContext.turn.workspaceFolder);
    return chunkingStatus === 'completed' && rankingStatus === 'completed'
      ? 'indexed'
      : chunkingStatus === 'started' || rankingStatus === 'started'
        ? 'indexing'
        : 'not_indexed';
  }

  async collectLocalSnippets(turnContext: TurnContext): Promise<DocumentChunk[]> {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) return [];
    const ctx = turnContext.ctx;
    if (ctx.get(ChunkingProvider).chunkCount(workspaceFolder) === 0) {
      return [];
    }
    let keywords;
    try {
      keywords = await parseUserQuery(turnContext, turnContext.cancelationToken);
    } catch (e) {
      const error = new LocalSnippetProviderError(e);
      telemetryException(ctx, error, 'LocalSnippetProvider.parseUserQuery');
    }
    if (keywords === undefined) return [];
    const rankingProvider = ctx.get(RankingProvider);
    let documentChunks: DocumentChunk[] = [];
    try {
      const { snippets, rankingTimeMs } = await rankingProvider.query(ctx, workspaceFolder, keywords);
      this.rankingTimeHistory[turnContext.turn.id] = rankingTimeMs;
      documentChunks = snippets;
    } catch (e) {
      const error = new LocalSnippetProviderError(e);
      this.rankingTimeHistory[turnContext.turn.id] = -1;
      telemetryException(ctx, error, 'LocalSnippetProvider.rankingQuery');
    }
    return documentChunks;
  }

  async rerankLocalSnippets(turnContext: TurnContext, snippets: SnippetType[]): Promise<Snippet.Snippet[]> {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) return [];
    const ctx = turnContext.ctx;
    const userQuery = turnContext.turn.request.message;
    let snippetIds: string[] = [];
    try {
      snippetIds = await rerankSnippets(ctx, workspaceFolder, userQuery, snippets, 5, turnContext.cancelationToken);
    } catch (e) {
      const error = new LocalSnippetProviderError(e);
      telemetryException(ctx, error, 'LocalSnippetProvider.rerankSnippets');
    }
    const projectContext = [];
    const fileReader = ctx.get(FileReader);
    for (const snippetId of snippetIds) {
      let filepath = snippetId.split('#')[0];
      let file = await fileReader.readFile(filepath);
      let snippet = snippets.find((s) => s.id === snippetId)!;
      if (file.status === 'valid') {
        let start = file.document.positionAt(snippet.range.start);
        let end = file.document.positionAt(snippet.range.end);
        let range = LocationFactory.range(start, end);
        projectContext.push({ uri: file.document.uri, range, snippet: snippet.chunk });
      }
    }
    return projectContext;
  }

  async provideSnippets(
    turnContext: TurnContext
  ): Promise<{ snippets: Snippet.Snippet[]; measurements?: Snippet.Measurement }> {
    const snippets = await this.collectLocalSnippets(turnContext);
    if (snippets.length === 0) {
      return { snippets: [], measurements: this.collectMeasurements(turnContext) };
    }
    const ctx = turnContext.ctx;
    conversationLogger.debug(ctx, `LocalSnippetProvider: First pass: Found ${snippets.length} snippets.`);
    const rankedSnippets = await this.rerankLocalSnippets(turnContext, snippets);
    const measurements = this.collectMeasurements(turnContext);
    return { snippets: rankedSnippets, measurements };
  }

  collectMeasurements(turnContext: TurnContext): Snippet.Measurement | undefined {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) {
      return;
    }
    const chunkingProvider = turnContext.ctx.get(ChunkingProvider);
    return {
      chunkCount: chunkingProvider.chunkCount(workspaceFolder),
      fileCount: chunkingProvider.fileCount(workspaceFolder),
      chunkingTimeMs: Math.floor(chunkingProvider.chunkingTimeMs(workspaceFolder)),
      rankingTimeMs: Math.floor(this.rankingTimeHistory[turnContext.turn.id] ?? 0),
    };
  }
}

export { LocalSnippetProvider, LocalSnippetProviderError };
