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
import { URI } from 'vscode-uri';
import { DocumentChunk } from './IndexingTypes.ts';

class LocalSnippetProviderError extends Error {
  readonly name = 'LocalSnippetProviderError';
  constructor(message: string) {
    super(message);
  }
}

class LocalSnippetProvider implements Snippet.ISnippetProvider {
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
    const fsPath = URI.parse(workspaceFolder).fsPath;
    const ctx = turnContext.ctx;
    const userQuery = turnContext.turn.request.message;
    if (ctx.get(ChunkingProvider).chunkCount(fsPath) === 0) return [];
    let keywords;
    try {
      keywords = await parseUserQuery(ctx, userQuery, turnContext.cancelationToken);
    } catch (e) {
      let error = new LocalSnippetProviderError((e as any).message);
      telemetryException(ctx, error, 'LocalSnippetProvider.parseUserQuery');
    }
    if (keywords === undefined) return [];
    const rankingProvider = ctx.get(RankingProvider);
    let documentChunks: DocumentChunk[] = [];
    try {
      const { snippets, rankingTimeMs } = await rankingProvider.query(ctx, fsPath, keywords);
      this.rankingTimeHistory[userQuery] = rankingTimeMs;
      documentChunks = snippets;
    } catch (e) {
      let error = new LocalSnippetProviderError((e as any).message);
      this.rankingTimeHistory[userQuery] = -1;
      telemetryException(ctx, error, 'LocalSnippetProvider.rankingQuery');
    }
    return documentChunks;
  }

  async rerankLocalSnippets(turnContext: TurnContext, snippets: SnippetType[]): Promise<Snippet.Snippet[]> {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) return [];
    const ctx = turnContext.ctx;
    const userQuery = turnContext.turn.request.message;
    const fsPath = URI.parse(workspaceFolder).fsPath;
    let snippetIds: string[] = [];
    try {
      snippetIds = await rerankSnippets(ctx, fsPath, userQuery, snippets, 5, turnContext.cancelationToken);
    } catch (e) {
      let error = new LocalSnippetProviderError((e as any).message);
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
        projectContext.push({ path: file.document.vscodeUri.fsPath, range: range, snippet: snippet.chunk });
      }
    }
    return projectContext;
  }

  async provideSnippets(
    turnContext: TurnContext
  ): Promise<{ snippets: Snippet.Snippet[]; resolution: Snippet.Resolution }> {
    const snippets = await this.collectLocalSnippets(turnContext);
    const ctx = turnContext.ctx;
    conversationLogger.debug(ctx, `LocalSnippetProvider: First pass: Found ${snippets.length} snippets.`);
    const rankedSnippets = await this.rerankLocalSnippets(turnContext, snippets);
    const resolution = this.collectResolutionProperties(turnContext);
    return { snippets: rankedSnippets, resolution };
  }

  collectResolutionProperties(turnContext: TurnContext): Snippet.Resolution {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    const resolution: Snippet.Resolution = {};
    if (!workspaceFolder) return resolution;
    const fsPath = URI.parse(workspaceFolder).fsPath;
    const chunkingProvider = turnContext.ctx.get(ChunkingProvider);
    resolution.chunkCount = chunkingProvider.chunkCount(fsPath);
    resolution.fileCount = chunkingProvider.fileCount(fsPath);
    resolution.chunkingTimeMs = Math.floor(chunkingProvider.chunkingTimeMs(fsPath));
    resolution.rankingTimeMs = Math.floor(this.rankingTimeHistory[turnContext.turn.request.message]);
    return resolution;
  }
}

export { LocalSnippetProvider };
