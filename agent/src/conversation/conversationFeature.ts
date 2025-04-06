import type { Context } from '../../../lib/src/context.ts';

import { AgentConversationInspector } from './conversationInspector.ts';
import { AgentConversationProgress } from './conversationProgress.ts';
import { PreconditionsNotifier } from './preconditionsNotifier.ts';
import { AgentSkillResolver } from './skillResolver.ts';
import { SyntheticTurns } from './syntheticTurnProcessor.ts';
import { TurnProcessorFactory } from './turnProcessorFactory.ts';
import { ConversationInspector } from '../../../lib/src/conversation/conversationInspector.ts';
import { ConversationProgress } from '../../../lib/src/conversation/conversationProgress.ts';
import { Conversations } from '../../../lib/src/conversation/conversations.ts';
import { ConversationDumper } from '../../../lib/src/conversation/dump.ts';
import { activateExtensibilityPlatformFeature } from '../../../lib/src/conversation/extensibility/extensibilityPlatformFeature.ts';
import {
  DefaultModelConfigurationProvider,
  ModelConfigurationProvider,
} from '../../../lib/src/conversation/modelConfigurations.ts';
import {
  CapiModelMetadataProvider,
  ExpModelMetadataProvider,
  ModelMetadataProvider,
} from '../../../lib/src/conversation/modelMetadata.ts';
import { PreconditionsCheck } from '../../../lib/src/conversation/preconditions.ts';
import { ConversationPromptEngine } from '../../../lib/src/conversation/prompt/conversationPromptEngine.ts';
import { ConversationSkillRegistry } from '../../../lib/src/conversation/prompt/conversationSkill.ts';
import {
  BuildLogsSchema,
  BuildLogsSkill,
  BuildLogsSkillId,
} from '../../../lib/src/conversation/skills/BuildLogsSkill.ts';
import {
  CurrentEditorSchema,
  CurrentEditorSkill,
  CurrentEditorSkillId,
} from '../../../lib/src/conversation/skills/CurrentEditorSkill.ts';
import {
  GitMetadataSchema,
  GitMetadataSkill,
  GitMetadataSkillId,
} from '../../../lib/src/conversation/skills/GitMetadataSkill.ts';
import {
  ProblemsInActiveDocumentSchema,
  ProblemsInActiveDocumentSkill,
  ProblemsInActiveDocumentSkillId,
} from '../../../lib/src/conversation/skills/ProblemInActiveDocumentSkill.ts';
import {
  ProjectContextSkill,
  ProjectContextSkillResolver,
} from '../../../lib/src/conversation/skills/ProjectContextSkill.ts';
import {
  ProjectLabelsSchema,
  ProjectLabelsSkill,
  ProjectLabelsSkillId,
} from '../../../lib/src/conversation/skills/ProjectLabelsSkill.ts';
import {
  ProjectMetadataSchema,
  ProjectMetadataSkill,
  ProjectMetadataSkillId,
} from '../../../lib/src/conversation/skills/ProjectMetadataSkill.ts';
import {
  RecentFilesSchema,
  RecentFilesSkill,
  RecentFilesSkillId,
} from '../../../lib/src/conversation/skills/RecentFilesSkill.ts';
import { ReferencesSkill } from '../../../lib/src/conversation/skills/ReferencesSkill.ts';
import {
  RuntimeLogsSchema,
  RuntimeLogsSkill,
  RuntimeLogsSkillId,
} from '../../../lib/src/conversation/skills/RuntimeLogsSkill.ts';
import {
  TestContextSchema,
  TestContextSkill,
  TestContextSkillId,
} from '../../../lib/src/conversation/skills/TestContextSkill.ts';
import {
  TestFailuresSchema,
  TestFailuresSkill,
  TestFailuresSkillId,
} from '../../../lib/src/conversation/skills/TestFailuresSkill.ts';
import { BlackbirdIndexingStatus } from '../../../lib/src/conversation/skills/projectContextSnippetProviders/indexingStatus.ts';
import { ChunkingProvider } from '../../../lib/src/conversation/skills/projectContextSnippetProviders/localSnippets/ChunkingProvider.ts';
import { RankingProvider } from '../../../lib/src/conversation/skills/projectContextSnippetProviders/localSnippets/RankingProvider.ts';
import { ScoringProvider } from '../../../lib/src/conversation/skills/projectContextSnippetProviders/localSnippets/ScoringProvider.ts';

function activateConversationFeature(ctx: Context): void {
  registerContextDependencies(ctx);
  registerSkills(ctx);
  activateExtensibilityPlatformFeature(ctx);
}

function registerContextDependencies(ctx: Context): void {
  ctx.set(Conversations, new Conversations(ctx));
  ctx.set(ConversationDumper, new ConversationDumper());
  ctx.set(ConversationPromptEngine, new ConversationPromptEngine(ctx));
  ctx.set(ModelConfigurationProvider, new DefaultModelConfigurationProvider(ctx));
  ctx.set(SyntheticTurns, new SyntheticTurns());
  ctx.set(ConversationProgress, new AgentConversationProgress(ctx));
  ctx.set(PreconditionsCheck, new PreconditionsCheck(ctx));
  ctx.set(PreconditionsNotifier, new PreconditionsNotifier(ctx));
  ctx.set(ModelMetadataProvider, new ExpModelMetadataProvider(ctx, new CapiModelMetadataProvider(ctx)));
  ctx.set(TurnProcessorFactory, new TurnProcessorFactory());
  ctx.set(BlackbirdIndexingStatus, new BlackbirdIndexingStatus());
  ctx.set(ConversationInspector, new AgentConversationInspector(ctx));
  ctx.set(ChunkingProvider, new ChunkingProvider(ctx));
  ctx.set(RankingProvider, new RankingProvider());
  ctx.set(ScoringProvider, new ScoringProvider());
}

function registerSkills(ctx: Context): void {
  const registry = new ConversationSkillRegistry();
  registry.registerSkill(new ProjectContextSkill(new ProjectContextSkillResolver(ctx)));
  registry.registerSkill(
    new ProjectMetadataSkill(new AgentSkillResolver(ctx, ProjectMetadataSkillId, ProjectMetadataSchema))
  );
  registry.registerSkill(
    new ProjectLabelsSkill(new AgentSkillResolver(ctx, ProjectLabelsSkillId, ProjectLabelsSchema))
  );
  registry.registerSkill(
    new CurrentEditorSkill(new AgentSkillResolver(ctx, CurrentEditorSkillId, CurrentEditorSchema))
  );
  registry.registerSkill(new ReferencesSkill());
  registry.registerSkill(new RecentFilesSkill(new AgentSkillResolver(ctx, RecentFilesSkillId, RecentFilesSchema)));
  registry.registerSkill(new GitMetadataSkill(new AgentSkillResolver(ctx, GitMetadataSkillId, GitMetadataSchema)));
  registry.registerSkill(
    new ProblemsInActiveDocumentSkill(
      new AgentSkillResolver(ctx, ProblemsInActiveDocumentSkillId, ProblemsInActiveDocumentSchema)
    )
  );
  registry.registerSkill(new RuntimeLogsSkill(new AgentSkillResolver(ctx, RuntimeLogsSkillId, RuntimeLogsSchema)));
  registry.registerSkill(new BuildLogsSkill(new AgentSkillResolver(ctx, BuildLogsSkillId, BuildLogsSchema)));
  registry.registerSkill(new TestContextSkill(new AgentSkillResolver(ctx, TestContextSkillId, TestContextSchema)));
  registry.registerSkill(new TestFailuresSkill(new AgentSkillResolver(ctx, TestFailuresSkillId, TestFailuresSchema)));

  ctx.set(ConversationSkillRegistry, registry);
}

export { activateConversationFeature, registerSkills };
