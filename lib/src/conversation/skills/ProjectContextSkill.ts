import { Type } from '@sinclair/typebox';
import { URI } from 'vscode-uri';

import { Snippet, Skill } from '../../types.ts';

import type { Context } from '../../context.ts';
import type { TurnContext } from '../turnContext.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { isTestFile } from '../prompt/testFiles.ts';
import { WorkspaceNotifier } from '../../workspaceNotifier.ts';
import { Features } from '../../experiments/features.ts';
import { ChunkingProvider } from './projectContextSnippetProviders/localSnippets/ChunkingProvider.ts';
import { WorkspaceWatcherProvider } from '../../workspaceWatcherProvider.ts';
import { RankingProvider } from './projectContextSnippetProviders/localSnippets/RankingProvider.ts';
import { ScoringProvider } from './projectContextSnippetProviders/localSnippets/ScoringProvider.ts';
import { ElidableDocument } from './ElidableDocument.ts';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';
import { IndexingStatusPriority } from './projectContextSnippetProviders/indexingStatus.ts';
import { LocalSnippetProvider } from './projectContextSnippetProviders/localSnippets/LocalSnippetProvider.ts';
import { SingleStepReportingSkill } from '../prompt/conversationSkill.ts';
import { CopilotTokenManager } from '../../auth/copilotTokenManager.ts';

const ProjectContextSnippetSchema = Type.Object({
  path: Type.String(),
  snippet: Type.String(),
  range: Type.Object({
    start: Type.Object({ line: Type.Number(), character: Type.Number() }),
    end: Type.Object({ line: Type.Number(), character: Type.Number() }),
  }),
});

const EMBEDDINGS_DELETION_DELAY = 30 * 60_000;

class ProjectContextSkillProcessor implements Skill.ISkillProcessor<Snippet.Snippet[]> {
  constructor(readonly turnContext: TurnContext) {}

  value() {
    return 1;
  }

  async processSkill(resolvedSkill: Snippet.Snippet[]): Promise<ElidableText | undefined> {
    if (this.turnContext.cancelationToken.isCancellationRequested) {
      this.turnContext.steps.cancel('collect-project-context');
    }
    const chunks: ElidableText.Chunk[] = [];
    const fileReader = this.turnContext.ctx.get(FileReader);
    const uniqueSnippets = this.removeDuplicateSnippets(resolvedSkill);
    for (const resolvedSnippet of uniqueSnippets) {
      const { path, snippet, range } = resolvedSnippet;
      const fileURI = URI.file(path);
      const uriPath = fileURI.toString();
      const documentResult = await fileReader.readFile(uriPath);
      if (documentResult.status === 'valid') {
        const elidableDoc = new ElidableDocument(documentResult.document, range, range);
        const elidableSnippet = new ElidableText([snippet]);
        const weight = (await isTestFile(fileURI)) ? 0.5 : 0.8;
        chunks.push([`Code excerpt from file \`${path}\`:`, 1], [elidableDoc.wrapInTicks(elidableSnippet, weight), 1]);
        await this.turnContext.collectFile(
          ProjectContextSkillId,
          uriPath,
          statusFromTextDocumentResult(documentResult),
          range
        );
      }
    }
    if (chunks.length > 0) {
      chunks.unshift([
        new ElidableText(['The user wants you to consider the following snippets when computing your answer.']),
        1,
      ]);
      return new ElidableText(chunks);
    }
  }

  removeDuplicateSnippets(snippets: Snippet.Snippet[]): Snippet.Snippet[] {
    const uniqueSnippets: Record<string, Snippet.Snippet> = {};
    for (const snippet of snippets) {
      const key = `${snippet.path}#[${snippet.range.start.line},${snippet.range.start.character}]-[${snippet.range.end.line},${snippet.range.end.character}]`;
      if (!uniqueSnippets[key]) {
        uniqueSnippets[key] = snippet;
      }
    }
    return Object.values(uniqueSnippets);
  }
}

class ProjectContextSkillResolver implements Skill.ISkillResolver<Snippet.Snippet[]> {
  _isEnabled?: boolean;

  constructor(
    readonly ctx: Context,
    readonly snippetProviders = [new LocalSnippetProvider()]
  ) {
    const workspaceNotifier = ctx.get(WorkspaceNotifier);
    workspaceNotifier.onChange((event) => {
      this.onWorkspacesAdded(event.added, ctx);
      this.onWorkspacesRemoved(event.removed, ctx);
    });
  }

  async isEnabled() {
    try {
      await this.ctx.get(CopilotTokenManager).getCopilotToken(this.ctx);
    } catch {
      return false;
    }
    let features = this.ctx.get(Features);
    let telemetryDataWithExp = await features.updateExPValuesAndAssignments();
    return features.ideChatEnableProjectContext(telemetryDataWithExp);
  }

  async onWorkspacesAdded(folders: URI[], ctx: Context) {
    if (!(folders.length && (await this.isEnabled()))) return;

    const chunkingProvider = ctx.get(ChunkingProvider);
    const workspaceWatcherProvider = ctx.get(WorkspaceWatcherProvider);
    const rankingProvider = ctx.get(RankingProvider);

    for (const folder of folders) {
      const workspaceFolder = folder.fsPath;

      if (!workspaceWatcherProvider.shouldStartWatching(folder)) continue;

      workspaceWatcherProvider.startWatching(folder);
      workspaceWatcherProvider.terminateSubfolderWatchers(folder);
      const chunks = await chunkingProvider.chunk(ctx, workspaceFolder);
      if (chunkingProvider.status(workspaceFolder) !== 'completed') {
        workspaceWatcherProvider.terminateWatching(folder);
        continue;
      }
      rankingProvider.initialize(ctx, workspaceFolder, chunks);
      workspaceWatcherProvider.onFileChange(folder, async ({ uris: uris, documents: documents, type: type }) => {
        if (type === 'delete' || type === 'update') {
          const deletedChunkIds = chunkingProvider.deleteFileChunks(workspaceFolder, uris);
          rankingProvider.deleteEmbeddings(ctx, workspaceFolder, deletedChunkIds);
        }
        if (type === 'create' || type === 'update') {
          const newChunks = await chunkingProvider.chunkFiles(ctx, workspaceFolder, documents);
          rankingProvider.addChunks(ctx, workspaceFolder, newChunks);
        }
      });
    }
  }

  async onWorkspacesRemoved(folders: URI[], ctx: Context) {
    if (!(folders.length && (await this.isEnabled()))) return;
    const chunkingProvider = ctx.get(ChunkingProvider);
    for (const folder of folders) {
      const workspaceFolder = folder.fsPath;
      const parentFolder = chunkingProvider.getParentFolder(workspaceFolder);
      if (parentFolder) {
        const chunkIds = chunkingProvider.deleteSubfolderChunks(parentFolder, workspaceFolder);
        ctx.get(RankingProvider).deleteEmbeddings(ctx, parentFolder, chunkIds);
        continue;
      }

      ctx.get(WorkspaceWatcherProvider).terminateWatching(folder);
      chunkingProvider.terminateChunking(workspaceFolder);
      ctx.get(RankingProvider).terminateRanking(ctx, workspaceFolder);
      ctx.get(ScoringProvider).terminateScoring(ctx, workspaceFolder);
    }
  }

  async resolveSkill(turnContext: TurnContext) {
    await turnContext.steps.start('collect-project-context', 'Collecting relevant project context');
    const statusPromises = this.snippetProviders.map(async (provider) => provider.snippetProviderStatus(turnContext));
    const providerStatus = await Promise.all(statusPromises);
    let bestSnippetProviderStatus = 'not_indexed';
    let snippetProvider;
    for (const indexingStatus of IndexingStatusPriority) {
      let first = providerStatus.findIndex((status) => status === indexingStatus);
      if (first !== -1) {
        bestSnippetProviderStatus = indexingStatus;
        snippetProvider = this.snippetProviders[first];
        break;
      }
    }
    switch (bestSnippetProviderStatus) {
      case 'indexed': {
        let { snippets, resolution } = await snippetProvider!.provideSnippets(turnContext);

        if (resolution) {
          turnContext.addSkillResolutionProperties(ProjectContextSkillId, resolution);
        }

        turnContext.steps.finish('collect-project-context');
        return snippets;
      }
      case 'indexing': {
        turnContext.steps.error('collect-project-context', 'Indexing repository, please try again later');
        return;
      }
      case 'not_indexed': {
        turnContext.steps.error('collect-project-context', 'No project context available');
        return;
      }
    }
  }
}

const ProjectContextSkillId: 'project-context' = 'project-context';

class ProjectContextSkill extends SingleStepReportingSkill<typeof ProjectContextSkillId, Snippet.Snippet[]> {
  constructor(_resolver: Skill.ISkillResolver<Snippet.Snippet[]>) {
    // assuming _resolver is some type of resolver
    super(
      ProjectContextSkillId,
      'Context about the project the user is working on including code snippets, documentation, and more.',
      'Performing code search',
      () => _resolver,
      (turnContext) => new ProjectContextSkillProcessor(turnContext),
      'implicit'
    );
  }
}

export {
  ProjectContextSnippetSchema,
  EMBEDDINGS_DELETION_DELAY,
  ProjectContextSkillProcessor,
  ProjectContextSkillResolver,
  ProjectContextSkillId,
  ProjectContextSkill,
};
