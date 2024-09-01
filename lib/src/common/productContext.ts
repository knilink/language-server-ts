import { Context } from "../context.ts";
import { ConfigProvider, BuildInfo, BlockModeConfig, GitHubAppInfo, ConfigBlockModeConfig } from "../config.ts";
import { Clock } from "../clock.ts";
import { CompletionsCache } from "../ghostText/completionsCache.ts";
import { CopilotTokenNotifier } from "../auth/copilotTokenNotifier.ts";
import { getRootCertificateReader, RootCertificateReader } from "../network/certificateReaders.ts";
import { ProxySocketFactory, getProxySocketFactory } from "../network/proxySockets.ts";
import { LanguageDetection, getLanguageDetection } from "../language/languageDetection.ts";
import { Features } from "../experiments/features.ts";
import { PostInsertionNotifier } from "../postInsertionNotifier.ts";
import { GitParsingConfigLoader } from "../repository/configParser.ts";
import { ExceptionRateLimiter } from "../telemetry/rateLimiter.ts";
import { TelemetryUserConfig } from "../telemetry/userConfig.ts";
import { TelemetryReporters } from "../telemetry.ts";
import { TelemetryInitialization } from "../telemetry/setupTelemetryReporters.ts";
import { HeaderContributors } from "../headerContributors.ts";
import { UserErrorNotifier } from "../error/userErrorNotifier.ts";
import { ContextualFilterManager } from "../ghostText/contextualFilter.ts";
import { OpenAIFetcher, LiveOpenAIFetcher } from "../openai/fetch.ts";
import { ExpConfigMaker, ExpConfigFromTAS } from "../experiments/fetchExperiments.ts";
import { PromiseQueue } from "../util/promiseQueue.ts";
import { SnippetOrchestrator } from "../../../prompt/src/orchestrator.ts";
import { LastGhostText } from "../ghostText/last.ts";
import { ForceMultiLine, forceMultiLine } from "../ghostText/ghostText.ts";
import { RepositoryManager } from "../repository/repositoryManager.ts";
import { GitConfigLoader, GitFallbackConfigLoader, GitCLIConfigLoader } from "../repository/config.ts";
import { WorkspaceNotifier } from "../workspaceNotifier.ts";
import { AvailableModelManager } from "../openai/model.ts";
import { RuntimeMode } from "../testing/runtimeMode.ts";
import { LogTarget, ConsoleLog, Logger, LogLevel } from "../logger.ts";

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
