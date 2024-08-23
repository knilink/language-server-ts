import { Context } from '../context';
import { ConfigProvider, BuildInfo, BlockModeConfig, GitHubAppInfo, ConfigBlockModeConfig } from '../config';
import { Clock } from '../clock';
import { CompletionsCache } from '../ghostText/completionsCache';
import { CopilotTokenNotifier } from '../auth/copilotTokenNotifier';
import { getRootCertificateReader, RootCertificateReader } from '../network/certificateReaders';
import { ProxySocketFactory, getProxySocketFactory } from '../network/proxySockets';
import { LanguageDetection, getLanguageDetection } from '../language/languageDetection';
import { Features } from '../experiments/features';
import { PostInsertionNotifier } from '../postInsertionNotifier';
import { GitParsingConfigLoader } from '../repository/configParser';
import { ExceptionRateLimiter } from '../telemetry/rateLimiter';
import { TelemetryUserConfig } from '../telemetry/userConfig';
import { TelemetryReporters } from '../telemetry';
import { TelemetryInitialization } from '../telemetry/setupTelemetryReporters';
import { HeaderContributors } from '../headerContributors';
import { UserErrorNotifier } from '../error/userErrorNotifier';
import { ContextualFilterManager } from '../ghostText/contextualFilter';
import { OpenAIFetcher, LiveOpenAIFetcher } from '../openai/fetch';
import { ExpConfigMaker, ExpConfigFromTAS } from '../experiments/fetchExperiments';
import { PromiseQueue } from '../util/promiseQueue';
import { SnippetOrchestrator } from '../../../prompt/src/orchestrator';
import { LastGhostText } from '../ghostText/last';
import { ForceMultiLine, forceMultiLine } from '../ghostText/ghostText';
import { RepositoryManager } from '../repository/repositoryManager';
import { GitConfigLoader, GitFallbackConfigLoader, GitCLIConfigLoader } from '../repository/config';
import { WorkspaceNotifier } from '../workspaceNotifier';
import { AvailableModelManager } from '../openai/model';
import { RuntimeMode } from '../testing/runtimeMode';
import { LogTarget, ConsoleLog, Logger, LogLevel } from '../logger';

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
  ctx.set(LanguageDetection, getLanguageDetection(ctx));
  ctx.set(Features, new Features(ctx));
  ctx.set(PostInsertionNotifier, new PostInsertionNotifier());
  ctx.set(ExceptionRateLimiter, new ExceptionRateLimiter());
  ctx.set(TelemetryUserConfig, new TelemetryUserConfig(ctx));
  ctx.set(TelemetryReporters, new TelemetryReporters());
  ctx.set(TelemetryInitialization, new TelemetryInitialization());
  ctx.set(HeaderContributors, new HeaderContributors());
  ctx.set(UserErrorNotifier, new UserErrorNotifier());
  ctx.set(ContextualFilterManager, new ContextualFilterManager());
  ctx.set(OpenAIFetcher, new LiveOpenAIFetcher());
  ctx.set(BlockModeConfig, new ConfigBlockModeConfig());
  ctx.set(ExpConfigMaker, new ExpConfigFromTAS());
  ctx.set(PromiseQueue, new PromiseQueue());
  ctx.set(SnippetOrchestrator, new SnippetOrchestrator());
  ctx.set(LastGhostText, new LastGhostText());
  ctx.set(ForceMultiLine, forceMultiLine);
  ctx.set(RepositoryManager, new RepositoryManager(ctx));
  ctx.set(GitConfigLoader, new GitFallbackConfigLoader([new GitCLIConfigLoader(), new GitParsingConfigLoader()]));
  ctx.set(WorkspaceNotifier, new WorkspaceNotifier());
  ctx.set(AvailableModelManager, new AvailableModelManager());
  ctx.set(GitHubAppInfo, new GitHubAppInfo());
  return ctx;
}

function setupRudimentaryLogging(ctx: Context): void {
  ctx.set(RuntimeMode, RuntimeMode.fromEnvironment(false));
  ctx.set(LogTarget, new ConsoleLog(console));
}

const logger = new Logger(LogLevel.INFO, 'context');

export { createProductionContext, setupRudimentaryLogging, logger };
