import { Context } from '../../../lib/src/context';
import { activateExtensibilityPlatformFeature } from '../../../lib/src/conversation/extensibility/extensibilityPlatformFeature';
import { Conversations } from '../../../lib/src/conversation/conversations';
import { ConversationDumper } from '../../../lib/src/conversation/dump';
import { ConversationPromptEngine } from '../../../lib/src/conversation/prompt/conversationPromptEngine';
import {
  ModelConfigurationProvider,
  DefaultModelConfigurationProvider,
} from '../../../lib/src/conversation/modelConfigurations';
import { SyntheticTurns } from './syntheticTurnProcessor';
import { ConversationProgress } from '../../../lib/src/conversation/conversationProgress';
import { PreconditionsCheck } from '../../../lib/src/conversation/preconditions';
import { PreconditionsNotifier } from './preconditionsNotifier';
import { HeaderContributors } from '../../../lib/src/headerContributors';
import { ModelMetadataProvider, pickModelMetadataProvider } from '../../../lib/src/conversation/modelMetadata';
import { TurnProcessorFactory } from './turnProcessorFactory';
import { BlackbirdIndexingStatus } from '../../../lib/src/conversation/skills/projectContextSnippetProviders/indexingStatus';
import { ConversationInspector } from '../../../lib/src/conversation/conversationInspector';
import { ChunkingProvider } from '../../../lib/src/conversation/skills/projectContextSnippetProviders/localSnippets/ChunkingProvider';
import { RankingProvider } from '../../../lib/src/conversation/skills/projectContextSnippetProviders/localSnippets/RankingProvider';
import { ScoringProvider } from '../../../lib/src/conversation/skills/projectContextSnippetProviders/localSnippets/ScoringProvider';
import { ConversationSkillRegistry } from '../../../lib/src/conversation/prompt/conversationSkill';
import { AgentConversationProgress } from './conversationProgress';
import { CapiVersionHeaderContributor } from '../../../lib/src/conversation/capiVersionHeaderContributor';
import { AgentConversationInspector } from './conversationInspector';
import {
  ProjectContextSkill,
  ProjectContextSkillResolver,
} from '../../../lib/src/conversation/skills/ProjectContextSkill';
import {
  ProjectMetadataSkill,
  ProjectMetadataSkillId,
  ProjectMetadataSchema,
} from '../../../lib/src/conversation/skills/ProjectMetadataSkill';
import { AgentSkillResolver } from './skillResolver';
import {
  ProjectLabelsSkill,
  ProjectLabelsSkillId,
  ProjectLabelsSchema,
} from '../../../lib/src/conversation/skills/ProjectLabelsSkill';
import {
  CurrentEditorSkill,
  CurrentEditorSkillId,
  CurrentEditorSchema,
} from '../../../lib/src/conversation/skills/CurrentEditorSkill';
import { ReferencesSkill } from '../../../lib/src/conversation/skills/ReferencesSkill';
import {
  RecentFilesSkill,
  RecentFilesSkillId,
  RecentFilesSchema,
} from '../../../lib/src/conversation/skills/RecentFilesSkill';
import {
  GitMetadataSkill,
  GitMetadataSkillId,
  GitMetadataSchema,
} from '../../../lib/src/conversation/skills/GitMetadataSkill';
import {
  ProblemsInActiveDocumentSkill,
  ProblemsInActiveDocumentSkillId,
  ProblemsInActiveDocumentSchema,
} from '../../../lib/src/conversation/skills/ProblemInActiveDocumentSkill';
import {
  RuntimeLogsSkill,
  RuntimeLogsSkillId,
  RuntimeLogsSchema,
} from '../../../lib/src/conversation/skills/RuntimeLogsSkill';
import { BuildLogsSkill, BuildLogsSkillId, BuildLogsSchema } from '../../../lib/src/conversation/skills/BuildLogsSkill';
import {
  TestContextSkill,
  TestContextSkillId,
  TestContextSchema,
} from '../../../lib/src/conversation/skills/TestContextSkill';
import {
  TestFailuresSkill,
  TestFailuresSkillId,
  TestFailuresSchema,
} from '../../../lib/src/conversation/skills/TestFailuresSkill';

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

  ctx.get(HeaderContributors).add(new CapiVersionHeaderContributor(ctx));

  ctx.set(ModelMetadataProvider, pickModelMetadataProvider(ctx));
  ctx.set(TurnProcessorFactory, new TurnProcessorFactory());
  ctx.set(BlackbirdIndexingStatus, new BlackbirdIndexingStatus());
  ctx.set(ConversationInspector, new AgentConversationInspector(ctx));
  ctx.set(ChunkingProvider, new ChunkingProvider());
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
