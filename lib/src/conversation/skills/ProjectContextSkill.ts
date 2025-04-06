import type { WorkspaceFolder } from 'vscode-languageserver-types';
import type { Snippet, Skill } from '../../types.ts';
import type { Context } from '../../context.ts';
import type { TurnContext } from '../turnContext.ts';

import * as os from 'os';
import * as microjob from 'microjob';
import { dedent } from 'ts-dedent';
import { ElidableDocument } from './ElidableDocument.ts';
import { IndexingStatusPriority } from './projectContextSnippetProviders/indexingStatus.ts';
import { ChunkingProvider } from './projectContextSnippetProviders/localSnippets/ChunkingProvider.ts';
import { LocalSnippetProvider } from './projectContextSnippetProviders/localSnippets/LocalSnippetProvider.ts';
import { RankingProvider } from './projectContextSnippetProviders/localSnippets/RankingProvider.ts';
import { ScoringProvider } from './projectContextSnippetProviders/localSnippets/ScoringProvider.ts';
import { SingleStepReportingSkill } from '../prompt/conversationSkill.ts';
import { isTestFile } from '../prompt/testFiles.ts';
import { telemetryIndexCodesearch } from '../telemetry.ts';
import { CopilotTokenManager } from '../../auth/copilotTokenManager.ts';
import { Features } from '../../experiments/features.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { getFsPath } from '../../util/uri.ts';
import { WorkspaceNotifier } from '../../workspaceNotifier.ts';
import { WorkspaceWatcherProvider } from '../../workspaceWatcherProvider.ts';
import { Type } from '@sinclair/typebox';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';
import type {} from './projectContextSnippetProviders/localSnippets/ChunkingHandler.ts';
import type {} from '../../workspaceWatcher.ts';
import type { Static } from '@sinclair/typebox';
import type {} from '../../../../prompt/src/elidableText/index.ts';

const MAX_THREAD_COUNT = Math.max(os.cpus().length - 1, 1);

class WorkerPoolToken {
  static workerPoolStarted = false;
  static activeProcessCount = 0;
  static allTokens: WorkerPoolToken[] = [];

  isActive = true;

  static async startWorkerPool() {
    if (!WorkerPoolToken.workerPoolStarted) {
      WorkerPoolToken.workerPoolStarted = true;
      await microjob.start({ maxWorkers: MAX_THREAD_COUNT });
    }

    WorkerPoolToken.activeProcessCount++;
    const token = new WorkerPoolToken();
    WorkerPoolToken.allTokens.push(token);
    return token;
  }
  async stopWorkerPool() {
    if (this.isActive) {
      this.isActive = false;
      WorkerPoolToken.activeProcessCount--;

      if (WorkerPoolToken.activeProcessCount == 0) {
        await microjob.stop();
        WorkerPoolToken.workerPoolStarted = false;
      }

      if (WorkerPoolToken.allTokens.includes(this)) {
        WorkerPoolToken.allTokens.splice(WorkerPoolToken.allTokens.indexOf(this), 1);
      }
    }
  }

  static async forceStopWorkerPool() {
    const iter = WorkerPoolToken.allTokens[Symbol.iterator]();
    for (const token of iter) await token.stopWorkerPool();
    WorkerPoolToken.workerPoolStarted = false;
    WorkerPoolToken.activeProcessCount = 0;
  }
}

const startWorkerPool = WorkerPoolToken.startWorkerPool.bind(WorkerPoolToken);

const ProjectContextSnippetSchema = Type.Object({
  uri: Type.String(),
  snippet: Type.String(),
  range: Type.Object({
    start: Type.Object({ line: Type.Number(), character: Type.Number() }),
    end: Type.Object({ line: Type.Number(), character: Type.Number() }),
  }),
});
type ProjectContextSnippetType = Static<typeof ProjectContextSnippetSchema>;

const EMBEDDINGS_DELETION_DELAY = 30 * 60_000;

class ProjectContextSkillProcessor implements Skill.ISkillProcessor<Snippet.Snippet[]> {
  constructor(readonly turnContext: TurnContext) {}

  value() {
    return 1;
  }

  async processSkill(resolvedSkill: Snippet.Snippet[]): Promise<ElidableText | undefined> {
    if (this.turnContext.cancelationToken.isCancellationRequested) {
      await this.turnContext.steps.cancel(collectProjectContextStep);
      return;
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

const collectProjectContextStep = 'collect-project-context' as const;

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
      await this.ctx.get(CopilotTokenManager).getToken();
    } catch {
      return false;
    }
    let features = this.ctx.get(Features);
    let telemetryDataWithExp = await features.updateExPValuesAndAssignments();
    return features.ideChatEnableProjectContext(telemetryDataWithExp);
  }

  async onWorkspacesAdded(folders: WorkspaceFolder[], ctx: Context) {
    const workerPoolToken = await startWorkerPool();
    try {
      await this.doOnWorkspacesAdded(folders, ctx);
    } finally {
      await workerPoolToken.stopWorkerPool();
    }
  }

  async doOnWorkspacesAdded(folders: WorkspaceFolder[], ctx: Context) {
    if (!folders.length || !(await this.isEnabled())) {
      return;
    }

    const isSubfolder = (folder: WorkspaceFolder, parent: WorkspaceFolder) => {
      const folderUri = folder.uri;
      const parentUri = parent.uri.replace(/[#?].*/, '').replace(/\/?$/, '/');
      return folderUri !== parentUri && folderUri.startsWith(parentUri);
    };

    let workspaceFolders: WorkspaceFolder[] = [];
    for (const workspaceFolder of folders) {
      if (!workspaceFolder || workspaceFolders.some((scannedFolder) => isSubfolder(workspaceFolder, scannedFolder)))
        continue;
      workspaceFolders = workspaceFolders.filter((scannedFolder) => !isSubfolder(scannedFolder, workspaceFolder));
      workspaceFolders.push(workspaceFolder);
    }
    for (const workspaceFolder of workspaceFolders) {
      const chunkingProvider = ctx.get(ChunkingProvider);
      if (!workspaceFolder.uri) {
        continue;
      }
      const workspaceWatcherProvider = ctx.get(WorkspaceWatcherProvider);
      if (workspaceWatcherProvider.shouldStartWatching(workspaceFolder)) {
        workspaceWatcherProvider.startWatching(workspaceFolder);
        const subfolders = workspaceWatcherProvider.terminateSubfolderWatchers(workspaceFolder);
        const rankingProvider = ctx.get(RankingProvider);
        const scoringProvider = ctx.get(ScoringProvider);
        for (const subfolder of subfolders) {
          await chunkingProvider.terminateChunking(ctx, subfolder);
          await rankingProvider.terminateRanking(ctx, subfolder);
          scoringProvider.terminateScoring(ctx, workspaceFolder.uri);
        }
        const chunks = await chunkingProvider.chunk(ctx, workspaceFolder.uri);
        if (chunkingProvider.status(workspaceFolder.uri) !== 'completed') {
          workspaceWatcherProvider.terminateWatching(workspaceFolder);
          continue;
        }
        await rankingProvider.initialize(ctx, workspaceFolder.uri, chunks);

        workspaceWatcherProvider.onFileChange(workspaceFolder, async ({ documents, type }) => {
          const workerPoolToken = await startWorkerPool();
          try {
            const uris = documents.map((doc) => doc.uri);
            if (type === 'delete' || type === 'update') {
              const deletedChunks = await chunkingProvider.deleteFileChunks(workspaceFolder.uri, uris);
              await rankingProvider.deleteEmbeddings(ctx, workspaceFolder.uri, deletedChunks);
            }
            if (type === 'create' || type === 'update') {
              const newChunks = await chunkingProvider.chunk(ctx, workspaceFolder.uri, documents);
              await rankingProvider.addChunks(ctx, workspaceFolder.uri, newChunks);
            }
          } finally {
            await workerPoolToken.stopWorkerPool();
          }
        });
      }
    }
  }

  async onWorkspacesRemoved(folders: WorkspaceFolder[], ctx: Context) {
    if (!folders.length || !(await this.isEnabled())) {
      return;
    }
    const chunkingProvider = ctx.get(ChunkingProvider);
    for (const folder of folders) {
      const workspaceFolder = folder.uri;
      if (!workspaceFolder) {
        continue;
      }
      const parentFolder = chunkingProvider.getParentFolder(workspaceFolder);
      if (parentFolder) {
        const chunks = await chunkingProvider.deleteSubfolderChunks(parentFolder, workspaceFolder);
        await ctx.get(RankingProvider).deleteEmbeddings(ctx, parentFolder, chunks);
        continue;
      }
      ctx.get(WorkspaceWatcherProvider).terminateWatching(folder);
      await chunkingProvider.terminateChunking(ctx, workspaceFolder);
      await ctx.get(RankingProvider).terminateRanking(ctx, workspaceFolder);
      ctx.get(ScoringProvider).terminateScoring(ctx, workspaceFolder);
    }

    if (chunkingProvider.workspaceCount === 0) {
      await WorkerPoolToken.forceStopWorkerPool();
    }
  }

  async resolveSkill(turnContext: TurnContext): Promise<Snippet.Snippet[] | undefined> {
    await turnContext.steps.start(collectProjectContextStep, 'Collecting relevant project context');

    await turnContext.info(
      dedent`Project context is applied to this response, which may lead to slightly longer load times. For faster and more general Copilot responses, remove the project context option from your prompt.`
    );

    const statusPromises = this.snippetProviders.map(async (provider) => provider.snippetProviderStatus(turnContext));
    const providerStatus = await Promise.all(statusPromises);
    let bestSnippetProviderStatus = 'not_indexed';
    let snippetProvider: Snippet.ISnippetProvider | undefined;
    for (const indexingStatus of IndexingStatusPriority) {
      const first = providerStatus.findIndex((status) => status === indexingStatus);
      if (first !== -1) {
        bestSnippetProviderStatus = indexingStatus;
        snippetProvider = this.snippetProviders[first];
        break;
      }
    }
    switch (bestSnippetProviderStatus) {
      case 'indexed': {
        const { snippets, measurements } = await snippetProvider!.provideSnippets(turnContext);
        await telemetryIndexCodesearch(turnContext, snippetProvider!.providerType, measurements);
        if (snippets.length === 0) {
          await turnContext.steps.error(collectProjectContextStep, 'No project context found');
          return;
        }
        await turnContext.steps.finish(collectProjectContextStep);
        return snippets;
      }
      case 'indexing': {
        await turnContext.steps.error(collectProjectContextStep, 'Indexing repository, please try again later');
        return;
      }
      case 'not_indexed': {
        await turnContext.steps.error(collectProjectContextStep, 'No project context available');
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
        'Relevant: How do I add a custom server route?',
        'Relevant: Where is the code that processes the response from CopyableThreadElement?',
        'Relevant: Where do I add tests for the InputValidation class?',
        'Relevant: How to implement a shared buffer component',
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

export { ProjectContextSkill, ProjectContextSkillId, ProjectContextSkillResolver, startWorkerPool };

export type { ProjectContextSnippetType };
