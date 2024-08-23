import type { Range } from 'vscode-languageserver-types';

import type { Snippet } from '../../../../types';

import { RankingProvider } from './RankingProvider';
import { ChunkingProvider } from './ChunkingProvider';
import { parseUserQuery } from './UserQueryParser';
import { rerankSnippets } from './EmbeddingsReranker';
import { FileReader } from '../../../../fileReader';
import { conversationLogger } from '../../../logger';
import { type TurnContext } from '../../../turnContext';

class LocalSnippetProvider implements Snippet.ISnippetProvider {
  async canProvideSnippets(turnContext: TurnContext): Promise<boolean> {
    if (!turnContext.turn.workspaceFolder) return false;

    const ctx = turnContext.ctx;
    const rankingStatus = ctx.get(RankingProvider).status(ctx, turnContext.turn.workspaceFolder);

    return rankingStatus === 'completed';
  }

  async collectLocalSnippets(turnContext: TurnContext): Promise<string[]> {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) return [];

    await turnContext.steps.start('collect-snippets', 'Collecting relevant snippets');

    const ctx = turnContext.ctx;
    const userQuery = turnContext.turn.request.message;

    if (ctx.get(ChunkingProvider).chunkCount(workspaceFolder) === 0) {
      await turnContext.steps.finish('collect-snippets');
      return [];
    }

    const keywords = await parseUserQuery(ctx, userQuery, turnContext.cancelationToken);
    if (!keywords) {
      await turnContext.steps.finish('collect-snippets');
      return [];
    }

    const snippets = await ctx.get(RankingProvider).query(ctx, workspaceFolder, keywords);

    if (snippets.length === 0) {
      await turnContext.steps.finish('collect-snippets'), [];
      return [];
    } else {
      await turnContext.steps.finish('collect-snippets');
      return snippets;
    }
  }

  async rerankLocalSnippets(turnContext: TurnContext, snippets: string[]): Promise<Snippet.Snippet[]> {
    const workspaceFolder = turnContext.turn.workspaceFolder;
    if (!workspaceFolder) return [];

    await turnContext.steps.start('rank-snippets', 'Ranking snippets');

    const ctx = turnContext.ctx;
    const userQuery = turnContext.turn.request.message;
    const result = await rerankSnippets(ctx, workspaceFolder, userQuery, snippets, 5, turnContext.cancelationToken);

    const projectContext: Snippet.Snippet[] = [];
    const fileReader = ctx.get(FileReader);

    for (const snippet of result) {
      const filepath = snippet.id.split('#')[0];
      const file = await fileReader.readFile(filepath);

      if (file.status === 'valid') {
        const offset = file.document.getText().indexOf(snippet.text);
        const start = file.document.positionAt(offset);
        const end = file.document.positionAt(offset + snippet.text.length);

        projectContext.push({
          path: file.document.vscodeUri.fsPath,
          range: { start, end },
          snippet: snippet.text,
        });
      }
    }

    await turnContext.steps.finish('rank-snippets');
    return projectContext;
  }

  async provideSnippets(turnContext: TurnContext): Promise<Snippet.Snippet[]> {
    const snippets = await this.collectLocalSnippets(turnContext);
    const ctx = turnContext.ctx;

    conversationLogger.debug(ctx, `LocalSnippetProvider: First pass: Found ${snippets.length} snippets.`);
    return await this.rerankLocalSnippets(turnContext, snippets);
  }
}

export { LocalSnippetProvider };
