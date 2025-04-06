import { AsyncCompletionManager } from '../asyncCompletion/manager.ts';
import { CopilotTokenNotifier } from '../auth/copilotTokenNotifier.ts';
import { Clock } from '../clock.ts';
import { BlockModeConfig, BuildInfo, ConfigBlockModeConfig, ConfigProvider, GitHubAppInfo } from '../config.ts';
import { Context } from '../context.ts';
import { CapiVersionHeaderContributor } from '../conversation/capiVersionHeaderContributor.ts';
import { SpeculationFetcher } from '../copilotEdits/codeMapper/fetchSpeculation.ts';
import { UserErrorNotifier } from '../error/userErrorNotifier.ts';
import { Features } from '../experiments/features.ts';
import { ExpConfigFromTAS, ExpConfigMaker } from '../experiments/fetchExperiments.ts';
import { CompletionsCache } from '../ghostText/completionsCache.ts';
import { ContextualFilterManager } from '../ghostText/contextualFilter.ts';
import { CurrentGhostText } from '../ghostText/current.ts';
import { ForceMultiLine } from '../ghostText/ghostText.ts';
import { LastGhostText } from '../ghostText/last.ts';
import { HeaderContributors } from '../headerContributors.ts';
import { LogTarget, Logger, TelemetryLogSender } from '../logger.ts';
import { ConsoleLog } from '../logging/consoleLog.ts';
import { TelemetryLogSenderImpl } from '../logging/telemetryLogSender.ts';
import { RootCertificateReader, getRootCertificateReader } from '../network/certificateReaders.ts';
import { ProxySocketFactory, getProxySocketFactory } from '../network/proxySockets.ts';
import { LiveOpenAIFetcher, OpenAIFetcher } from '../openai/fetch.ts';
import { AvailableModelManager } from '../openai/model.ts';
import { PostInsertionNotifier } from '../postInsertionNotifier.ts';
import { CompletionsPromptFactory } from '../prompt/components/completionsPrompt.tsx';
import { GitParsingConfigLoader } from '../repository/configParser.ts';
import { GitCLIConfigLoader, GitConfigLoader, GitFallbackConfigLoader } from '../repository/config.ts';
import { RepositoryManager } from '../repository/repositoryManager.ts';
import { ExceptionRateLimiter } from '../telemetry/rateLimiter.ts';
import { TelemetryInitialization } from '../telemetry/setupTelemetryReporters.ts';
import { TelemetryUserConfig } from '../telemetry/userConfig.ts';
import { TelemetryReporters } from '../telemetry.ts';
import { RuntimeMode } from '../testing/runtimeMode.ts';
import { PromiseQueue } from '../util/promiseQueue.ts';
import { WorkspaceNotifier } from '../workspaceNotifier.ts';
import { SnippetOrchestrator } from '../../../prompt/src/orchestrator.ts';

function createProductionContext(configProvider: ConfigProvider): Context {
  const ctx = new Context();
  ctx.set(ConfigProvider, configProvider);
  ctx.set(Clock, new Clock());
  ctx.set(BuildInfo, new BuildInfo());
  setupRudimentaryLogging(ctx);
  ctx.set(CompletionsCache, new CompletionsCache());
  ctx.set(CopilotTokenNotifier, new CopilotTokenNotifier());
  ctx.set(RootCertificateReader, getRootCertificateReader(ctx));
  ctx.set(ProxySocketFactory, getProxySocketFactory(ctx));
  ctx.set(Features, new Features(ctx));
  ctx.set(PostInsertionNotifier, new PostInsertionNotifier());
  ctx.set(ExceptionRateLimiter, new ExceptionRateLimiter());
  ctx.set(TelemetryUserConfig, new TelemetryUserConfig(ctx));
  ctx.set(TelemetryReporters, new TelemetryReporters());
  ctx.set(TelemetryInitialization, new TelemetryInitialization());
  setHeaderContributors(ctx);
  ctx.set(UserErrorNotifier, new UserErrorNotifier());
  ctx.set(ContextualFilterManager, new ContextualFilterManager());
  ctx.set(OpenAIFetcher, new LiveOpenAIFetcher());
  ctx.set(BlockModeConfig, new ConfigBlockModeConfig());
  ctx.set(ExpConfigMaker, new ExpConfigFromTAS());
  ctx.set(PromiseQueue, new PromiseQueue());
  ctx.set(CompletionsPromptFactory, new CompletionsPromptFactory(ctx));
  ctx.set(SnippetOrchestrator, new SnippetOrchestrator());
  ctx.set(LastGhostText, new LastGhostText());
  ctx.set(CurrentGhostText, new CurrentGhostText());
  ctx.set(ForceMultiLine, ForceMultiLine.default);
  ctx.set(RepositoryManager, new RepositoryManager(ctx));
  ctx.set(GitConfigLoader, new GitFallbackConfigLoader([new GitCLIConfigLoader(), new GitParsingConfigLoader()]));
  ctx.set(WorkspaceNotifier, new WorkspaceNotifier());
  ctx.set(AvailableModelManager, new AvailableModelManager(ctx));
  ctx.set(GitHubAppInfo, new GitHubAppInfo());
  ctx.set(AsyncCompletionManager, new AsyncCompletionManager(ctx));
  ctx.set(SpeculationFetcher, new SpeculationFetcher(ctx));
  return ctx;
}

function setHeaderContributors(ctx: Context) {
  let headerContributors = new HeaderContributors();
  headerContributors.add(new CapiVersionHeaderContributor(ctx));
  ctx.set(HeaderContributors, headerContributors);
}

function setupRudimentaryLogging(ctx: Context) {
  ctx.set(RuntimeMode, RuntimeMode.fromEnvironment(false));
  ctx.set(TelemetryLogSender, new TelemetryLogSenderImpl());
  ctx.set(LogTarget, new ConsoleLog(console));
}

const logger = new Logger('context');

export { createProductionContext, setupRudimentaryLogging, logger };
