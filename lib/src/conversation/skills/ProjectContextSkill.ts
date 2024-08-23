import { Type } from '@sinclair/typebox';
import { URI } from 'vscode-uri';

import { Snippet, Skill } from '../../types';

import type { Context } from '../../context';
import type { TurnContext } from '../turnContext';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader';
import { isTestFile } from '../prompt/testFiles';
import { WorkspaceNotifier } from '../../workspaceNotifier';
import { Features } from '../../experiments/features';
import { ChunkingProvider } from './projectContextSnippetProviders/localSnippets/ChunkingProvider';
import { WorkspaceWatcherProvider } from '../../workspaceWatcherProvider';
import { RankingProvider } from './projectContextSnippetProviders/localSnippets/RankingProvider';
import { ScoringProvider } from './projectContextSnippetProviders/localSnippets/ScoringProvider';
import { ElidableDocument } from './ElidableDocument';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText';
import { BlackbirdSnippetProvider } from './projectContextSnippetProviders/BlackbirdSnippetProvider';
import { LocalSnippetProvider } from './projectContextSnippetProviders/localSnippets/LocalSnippetProvider';
import { SingleStepReportingSkill } from '../prompt/conversationSkill';

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
  constructor(readonly turnContext: TurnContext) { }

  value() {
    return 1;
  }

  async processSkill(resolvedSkill: Snippet.Snippet[]): Promise<ElidableText | undefined> {
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
        chunks.push([`Snippet from the file \`${path}\`:`, 1], [elidableDoc.wrapInTicks(elidableSnippet, weight), 1]);
        this.turnContext.collectFile(
          ProjectContextSkillId,
          uriPath,
          statusFromTextDocumentResult(documentResult),
          range
        );
      }
    }
    if (chunks.length > 0) {
      chunks.unshift([
        new ElidableText([
          'The user wants you to consider the following snippets. Take your time to determine if they are relevant. If you decide they are relevant, consider them when computing your answer.',
        ]),
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
    readonly snippetProviders = [new BlackbirdSnippetProvider(), new LocalSnippetProvider()]
  ) {
    const workspaceNotifier = ctx.get(WorkspaceNotifier);
    workspaceNotifier.onChange((event) => {
      this.onWorkspacesAdded(event.added, ctx);
      this.onWorkspacesRemoved(event.removed, ctx);
    });
  }

  async isEnabled() {
    if (this._isEnabled === undefined) {
      const features = this.ctx.get(Features);
      const telemetryDataWithExp = await features.updateExPValuesAndAssignments(this.ctx);
      this._isEnabled = features.ideChatEnableProjectContext(telemetryDataWithExp);
    }
    return this._isEnabled;
  }

  async onWorkspacesAdded(folders: URI[], ctx: Context) {
    if (!(folders.length && (await this.isEnabled()))) return;

    const chunkingProvider = ctx.get(ChunkingProvider);
    const workspaceWatcherProvider = ctx.get(WorkspaceWatcherProvider);
    const rankingProvider = ctx.get(RankingProvider);

    for (const folder of folders) {
      const workspaceFolder = folder.fsPath;
      if (chunkingProvider.isMarkedForDeletion(workspaceFolder)) {
        chunkingProvider.cancelDeletion(workspaceFolder);
      }

      if (!workspaceWatcherProvider.shouldStartWatching(folder)) continue;

      workspaceWatcherProvider.startWatching(folder);
      const chunks = await chunkingProvider.chunk(ctx, workspaceFolder);
      rankingProvider.initialize(ctx, workspaceFolder, chunks);
      workspaceWatcherProvider.onFileChange(folder, async ({ files, type }) => {
        if (type === 'delete' || type === 'update') {
          const deletedChunkIds = chunkingProvider.deleteFileChunks(workspaceFolder, files);
          rankingProvider.deleteEmbeddings(ctx, workspaceFolder, deletedChunkIds);
        }
        if (type === 'create' || type === 'update') {
          const newChunks = await chunkingProvider.chunkFiles(ctx, workspaceFolder, files);
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
      }

      if (chunkingProvider.isMarkedForDeletion(workspaceFolder)) continue;

      chunkingProvider.markForDeletion(workspaceFolder);
      ctx.get(WorkspaceWatcherProvider).stopWatching(folder);
      setTimeout(() => {
        const _chunkingProvider = ctx.get(ChunkingProvider);
        if (_chunkingProvider.isMarkedForDeletion(workspaceFolder)) {
          ctx.get(WorkspaceWatcherProvider).terminateWatching(folder);
          _chunkingProvider.terminateChunking(workspaceFolder);
          ctx.get(RankingProvider).terminateRanking(ctx, workspaceFolder);
          ctx.get(ScoringProvider).terminateScoring(ctx, workspaceFolder);
        }
      }, EMBEDDINGS_DELETION_DELAY);
    }
  }

  async resolveSkill(turnContext: TurnContext) {
    await turnContext.steps.start('check-indexing-status', 'Checking indexing status');
    for (const snippetProvider of this.snippetProviders) {
      if (await snippetProvider.canProvideSnippets(turnContext)) {
        await turnContext.steps.finish('check-indexing-status');
        return await snippetProvider.provideSnippets(turnContext);
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
