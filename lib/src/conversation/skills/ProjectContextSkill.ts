import { Type } from '@sinclair/typebox';

import { Snippet, Skill } from '../../types.ts';

import type { Context } from '../../context.ts';
import type { TurnContext } from '../turnContext.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { getFsPath } from '../../util/uri.ts';
import { isTestFile } from '../prompt/testFiles.ts';
import { telemetryCodeSearch } from '../telemetry.ts';
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
import { WorkspaceFolder } from 'vscode-languageserver-types';

const ProjectContextSnippetSchema = Type.Object({
  uri: Type.String(),
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
      const { uri, snippet, range } = resolvedSnippet;
      const documentResult = await fileReader.readFile(uri);
      if (documentResult.status === 'valid') {
        const elidableDoc = new ElidableDocument(documentResult.document, range, range);
        const elidableSnippet = new ElidableText([snippet]);
        const weight = (await isTestFile(uri)) ? 0.5 : 0.8;
        chunks.push(
          [`Code excerpt from file \`${getFsPath(uri)}\`:`, 1],
          [elidableDoc.wrapInTicks(elidableSnippet, weight), 1]
        );

        await this.turnContext.collectFile(
          ProjectContextSkillId,
          uri,
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
      const key = `${snippet.uri}#[${snippet.range.start.line},${snippet.range.start.character}]-[${snippet.range.end.line},${snippet.range.end.character}]`;
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

  async onWorkspacesAdded(folders: WorkspaceFolder[], ctx: Context) {
    if (folders.length && (await this.isEnabled())) {
      for (const folder of folders) {
        const chunkingProvider = ctx.get(ChunkingProvider);
        const workspaceFolder = folder.uri;
        if (!workspaceFolder) {
          continue;
        }
        let workspaceWatcherProvider = ctx.get(WorkspaceWatcherProvider);
        if (workspaceWatcherProvider.shouldStartWatching(folder)) {
          workspaceWatcherProvider.startWatching(folder);
          workspaceWatcherProvider.terminateSubfolderWatchers(folder);
          const chunks = await chunkingProvider.chunk(ctx, workspaceFolder);
          if (chunkingProvider.status(workspaceFolder) !== 'completed') {
            workspaceWatcherProvider.terminateWatching(folder);
            continue;
          }
          let rankingProvider = ctx.get(RankingProvider);
          rankingProvider.initialize(ctx, workspaceFolder, chunks);
          workspaceWatcherProvider.onFileChange(folder, async ({ documents, type }) => {
            const uris = documents.map((doc) => doc.uri);
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
    }
  }

  async onWorkspacesRemoved(folders: WorkspaceFolder[], ctx: Context) {
    if (folders.length && (await this.isEnabled())) {
      for (const folder of folders) {
        const chunkingProvider = ctx.get(ChunkingProvider);
        let workspaceFolder = folder.uri;
        if (!workspaceFolder) {
          continue;
        }
        let parentFolder = chunkingProvider.getParentFolder(workspaceFolder);
        if (parentFolder) {
          let chunkIds = chunkingProvider.deleteSubfolderChunks(parentFolder, workspaceFolder);
          ctx.get(RankingProvider).deleteEmbeddings(ctx, parentFolder, chunkIds);
          continue;
        }
        ctx.get(WorkspaceWatcherProvider).terminateWatching(folder);
        chunkingProvider.terminateChunking(workspaceFolder);
        ctx.get(RankingProvider).terminateRanking(ctx, workspaceFolder);
        ctx.get(ScoringProvider).terminateScoring(ctx, workspaceFolder);
      }
    }
  }

  async resolveSkill(turnContext: TurnContext): Promise<undefined> {
    await turnContext.steps.start('collect-project-context', 'Collecting relevant project context');
    const statusPromises = this.snippetProviders.map(async (provider) => provider.snippetProviderStatus(turnContext));
    const providerStatus = await Promise.all(statusPromises);
    let bestSnippetProviderStatus = 'not_indexed';
    let snippetProvider: Snippet.ISnippetProvider | undefined;
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
        const { snippets, measurements } = await snippetProvider!.provideSnippets(turnContext);
        await telemetryCodeSearch(turnContext, snippetProvider!.providerType, measurements);
        if (snippets.length === 0) {
          turnContext.steps.error('collect-project-context', 'No project context found');
          return;
        }
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
      'Code snippets and documentation from the open project. This skill is useful when the user question is specific to the open project and its context. Do not include this skill for general programming questions.',
      'Performing code search',
      () => _resolver,
      (turnContext) => new ProjectContextSkillProcessor(turnContext),
      'implicit',
      [
        'Relevant: Where is the code that processes the server response?',
        'Relevant: Where do I add tests for the InputValidation class?',
        'Relevant: How do I add a new custom server route?',
        'Not relevant: What does numpy do?',
      ],
      async (ctx) => {
        let features = ctx.get(Features);
        let telemetryWithExp = await features.updateExPValuesAndAssignments();
        return features.ideChatEnableProjectContext(telemetryWithExp);
      }
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
