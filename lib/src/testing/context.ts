import { TestRemoteAgentRegistry } from './conversationAgent.ts';
import { TestConversationInspector } from './conversationInspector.ts';
import { TestConversationProgress } from './conversationProgress.ts';
import { NoFetchFetcher, createTestCertificateReader } from './fetcher.ts';
import { TestModelConfigurationProvider } from './modelConfiguration.ts';
import { InMemoryPersistenceManager } from './persist.ts';
import { RuntimeMode } from './runtimeMode.ts';
import { TestNotificationSender, TestUrlOpener } from './testHelpers.ts';
import { TestTextDocumentManager } from './textDocument.ts';
import { FixedCopilotTokenManager } from './tokenManager.ts';
import { AsyncCompletionManager } from '../asyncCompletion/manager.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { CopilotTokenNotifier } from '../auth/copilotTokenNotifier.ts';
import { CitationManager, NoOpCitationManager } from '../citationManager.ts';
import { Clock } from '../clock.ts';
import {
  BlockModeConfig,
  BuildInfo,
  ConfigBlockModeConfig,
  ConfigProvider,
  DefaultsOnlyConfigProvider,
  EditorAndPluginInfo,
  EditorSession,
  GitHubAppInfo,
} from '../config.ts';
import { CopilotContentExclusionManager } from '../contentExclusion/contentExclusionManager.ts';
import { Context } from '../context.ts';
import { ConversationInspector } from '../conversation/conversationInspector.ts';
import { ConversationProgress } from '../conversation/conversationProgress.ts';
import { Conversations } from '../conversation/conversations.ts';
import { ConversationDumper } from '../conversation/dump.ts';
import { RemoteAgentRegistry } from '../conversation/extensibility/remoteAgentRegistry.ts';
import { GitHubRepositoryApi } from '../conversation/gitHubRepositoryApi.ts';
import { ModelConfigurationProvider } from '../conversation/modelConfigurations.ts';
import { PreconditionsCheck } from '../conversation/preconditions.ts';
import { ConversationPromptEngine } from '../conversation/prompt/conversationPromptEngine.ts';
import { ConversationSkillRegistry } from '../conversation/prompt/conversationSkill.ts';
import { BlackbirdIndexingStatus } from '../conversation/skills/projectContextSnippetProviders/indexingStatus.ts';
import { ChunkingProvider } from '../conversation/skills/projectContextSnippetProviders/localSnippets/ChunkingProvider.ts';
import { RankingProvider } from '../conversation/skills/projectContextSnippetProviders/localSnippets/RankingProvider.ts';
import { ScoringProvider } from '../conversation/skills/projectContextSnippetProviders/localSnippets/ScoringProvider.ts';
import { EditProgressReporter, LibTestEditProgressReporter } from '../copilotEdits/progress/editProgressReporter.ts';
import { EditConversations } from '../copilotEdits/services/editConversations.ts';
import { DefaultNetworkConfiguration } from '../defaultNetworkConfiguration.ts';
import { UserErrorNotifier } from '../error/userErrorNotifier.ts';
import { Features } from '../experiments/features.ts';
import { ExpConfigMaker, ExpConfigNone } from '../experiments/fetchExperiments.ts';
import { FileReader } from '../fileReader.ts';
import { FileSystem, LocalFileSystem } from '../fileSystem.ts';
import { CompletionsCache } from '../ghostText/completionsCache.ts';
import { ContextualFilterManager } from '../ghostText/contextualFilter.ts';
import { CurrentGhostText } from '../ghostText/current.ts';
import { ForceMultiLine } from '../ghostText/ghostText.ts';
import { LastGhostText } from '../ghostText/last.ts';
import { HeaderContributors } from '../headerContributors.ts';
import { LogTarget, TelemetryLogSender } from '../logger.ts';
import { TelemetryLogSenderImpl } from '../logging/telemetryLogSender.ts';
import { RootCertificateReader } from '../network/certificateReaders.ts';
import { ProxySocketFactory, getProxySocketFactory } from '../network/proxySockets.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { Fetcher } from '../networking.ts';
import { NotificationSender } from '../notificationSender.ts';
import { AvailableModelManager } from '../openai/model.ts';
import { PersistenceManager } from '../persist.ts';
import { PostInsertionNotifier } from '../postInsertionNotifier.ts';
import { NoOpStatusReporter, StatusReporter } from '../progress.ts';
import { CompletionsPromptFactory } from '../prompt/components/completionsPrompt.tsx';
import { ContextProviderRegistry, getContextProviderRegistry } from '../prompt/contextProviderRegistry.ts';
import { ContextProviderStatistics } from '../prompt/contextProviderStatistics.ts';
import { ExceptionRateLimiter } from '../telemetry/rateLimiter.ts';
import { TelemetryInitialization, setupTelemetryReporters } from '../telemetry/setupTelemetryReporters.ts';
import { TelemetryUserConfig } from '../telemetry/userConfig.ts';
import { TelemetryReporters } from '../telemetry.ts';
import { TextDocumentManager } from '../textDocumentManager.ts';
import { UrlOpener } from '../util/opener.ts';
import { PromiseQueue } from '../util/promiseQueue.ts';
import { WorkspaceNotifier } from '../workspaceNotifier.ts';
import { SnippetOrchestrator } from '../../../prompt/src/orchestrator.ts';

function _createBaselineContext(configProvider: ConfigProvider): Context {
  const ctx = new Context();
  ctx.set(ConfigProvider, configProvider);
  ctx.set(BuildInfo, new BuildInfo());
  ctx.set(RuntimeMode, new RuntimeMode({ debug: false, verboseLogging: false, testMode: true, simulation: false }));
  ctx.set(RootCertificateReader, createTestCertificateReader([]));
  ctx.set(ProxySocketFactory, getProxySocketFactory(ctx));
  ctx.set(Clock, new Clock());
  ctx.set(ExpConfigMaker, new ExpConfigNone());
  ctx.set(ContextualFilterManager, new ContextualFilterManager());
  ctx.set(CopilotTokenNotifier, new CopilotTokenNotifier());
  ctx.set(ExceptionRateLimiter, new ExceptionRateLimiter());
  ctx.set(TelemetryUserConfig, new TelemetryUserConfig(ctx, 'tid=test', true));
  ctx.set(TelemetryReporters, new TelemetryReporters());
  ctx.set(NotificationSender, new TestNotificationSender());
  ctx.set(UrlOpener, new TestUrlOpener());
  ctx.set(TelemetryLogSender, new TelemetryLogSenderImpl());
  ctx.set(LogTarget, new NullLog());
  ctx.set(UserErrorNotifier, new UserErrorNotifier());
  ctx.set(EditorSession, new EditorSession('test-session', 'test-machine'));
  ctx.set(NetworkConfiguration, new DefaultNetworkConfiguration(ctx));
  ctx.set(TelemetryInitialization, new TelemetryInitialization());
  setupTelemetryReporters(ctx, 'copilot-test', true);
  ctx.set(Features, new Features(ctx));
  ctx.set(CompletionsCache, new CompletionsCache());
  ctx.set(PostInsertionNotifier, new PostInsertionNotifier());
  ctx.set(BlockModeConfig, new ConfigBlockModeConfig());
  ctx.set(CopilotTokenManager, new FixedCopilotTokenManager('tid=test'));
  ctx.set(StatusReporter, new NoOpStatusReporter());
  ctx.set(HeaderContributors, new HeaderContributors());
  ctx.set(PromiseQueue, new PromiseQueue());
  ctx.set(CompletionsPromptFactory, new CompletionsPromptFactory(ctx));
  ctx.set(SnippetOrchestrator, new SnippetOrchestrator());
  ctx.set(LastGhostText, new LastGhostText());
  ctx.set(CurrentGhostText, new CurrentGhostText());
  ctx.set(ForceMultiLine, ForceMultiLine.default);
  ctx.set(WorkspaceNotifier, new WorkspaceNotifier());
  ctx.set(AvailableModelManager, new AvailableModelManager(ctx));
  ctx.set(GitHubAppInfo, new GitHubAppInfo());
  ctx.set(FileReader, new FileReader(ctx));
  ctx.set(CitationManager, new NoOpCitationManager());
  ctx.set(ContextProviderStatistics, new ContextProviderStatistics());

  ctx.set(
    ContextProviderRegistry,
    getContextProviderRegistry(ctx, async (_, documentSelector, documentContext) =>
      documentSelector.find((ds) => ds === '*')
        ? 1
        : documentSelector.find((ds) => typeof ds !== 'string' && ds.language === documentContext.languageId)
          ? 10
          : 0
    )
  );

  registerConversation(ctx);
  ctx.set(AsyncCompletionManager, new AsyncCompletionManager(ctx));
  return ctx;
}

function registerConversation(ctx: Context): void {
  ctx.set(Conversations, new Conversations(ctx));
  ctx.set(ConversationProgress, new TestConversationProgress());
  ctx.set(ConversationPromptEngine, new ConversationPromptEngine(ctx));
  ctx.set(ConversationSkillRegistry, new ConversationSkillRegistry());
  ctx.set(ConversationDumper, new ConversationDumper());
  ctx.set(ConversationInspector, new TestConversationInspector());
  ctx.set(PreconditionsCheck, new PreconditionsCheck(ctx, []));
  ctx.set(ModelConfigurationProvider, new TestModelConfigurationProvider());
  ctx.set(RemoteAgentRegistry, new TestRemoteAgentRegistry());
  ctx.set(GitHubRepositoryApi, new GitHubRepositoryApi(ctx));
  ctx.set(BlackbirdIndexingStatus, new BlackbirdIndexingStatus());
  ctx.set(ChunkingProvider, new ChunkingProvider(ctx));
  ctx.set(RankingProvider, new RankingProvider());
  ctx.set(ScoringProvider, new ScoringProvider());
}

function createLibTestingContext(): Context {
  const ctx = _createBaselineContext(new DefaultsOnlyConfigProvider());
  ctx.set(Fetcher, new NoFetchFetcher());
  ctx.set(EditorAndPluginInfo, new LibTestsEditorInfo());
  ctx.set(TextDocumentManager, new TestTextDocumentManager(ctx));
  ctx.set(FileSystem, new LocalFileSystem());
  ctx.set(CopilotContentExclusionManager, new CopilotContentExclusionManager(ctx));
  ctx.set(PersistenceManager, new InMemoryPersistenceManager());
  ctx.set(EditConversations, new EditConversations(ctx));
  ctx.set(EditProgressReporter, new LibTestEditProgressReporter(ctx));
  return ctx;
}

class NullLog extends LogTarget {
  logIt(..._: unknown[]) {}
}

class LibTestsEditorInfo extends EditorAndPluginInfo {
  getEditorInfo() {
    return { name: 'lib-tests-editor', version: '1' };
  }
  getEditorPluginInfo() {
    return { name: 'lib-tests-plugin', version: '2' };
  }
  getRelatedPluginInfo() {
    return [{ name: 'lib-tests-related-plugin', version: '3' }];
  }

  // EDITED required by base class
  setEditorAndPluginInfo() {}
  // EDITED required by base class
  setCopilotIntegrationId() {}
}

export { createLibTestingContext };
