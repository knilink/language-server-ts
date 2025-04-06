import * as fs from 'fs/promises';
import { default as os } from 'os';
import {
  IPCMessageReader,
  IPCMessageWriter,
  ProposedFeatures,
  StreamMessageReader,
  StreamMessageWriter,
  createConnection,
} from 'vscode-languageserver/node.js';
import { AgentRelatedFilesProvider } from './agentRelatedFilesProvider.ts';
import { AgentCopilotTokenManager } from './auth/copilotTokenManager.ts';
import { CLSCitationManager } from './citationManager.ts';
import { AgentConfigProvider, AgentEditorInfo } from './config.ts';
import { match } from './contextProvider.ts';
import { activateConversationFeature } from './conversation/conversationFeature.ts';
import { CopilotCompletionCache } from './copilotCompletionCache.ts';
import { AgentEditProgressReporter } from './copilotEdits/editProgressReporter.ts';
import { CopilotEditsExceptionHandler } from './copilotEdits/exceptionHandler.ts';
import { wrapTransports } from './debug.ts';
import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { FeatureFlagsNotifier } from './editorFeatures/featureFlagsNotifier.ts';
import { InitializedNotifier } from './editorFeatures/initializedNotifier.ts';
import { NotificationStatusReporter } from './editorFeatures/statusReporter.ts';
import { agentFileSystem } from './fileSystem.ts';
import { LspFileWatcher } from './lspFileWatcher.ts';
import { MethodHandlers, getAllMethods } from './methods/methods.ts';
import { applyHttpConfiguration } from './methods/notifyChangeConfiguration.ts';
import { ExternalTestingCompletionDocuments } from './methods/testing/setCompletionDocuments.ts';
import { CopilotEditsMockManager } from './methods/testing/setCopilotEditsResponse.ts';
import { ExternalTestingPanelCompletionDocuments } from './methods/testing/setPanelCompletionDocuments.ts';
import { AgentDelegatingFetcher } from './network/delegatingFetcher.ts';
import { ConnectionNotificationSender } from './notificationSender.ts';
import { ProgressTokens } from './progressTokens.ts';
import { Service } from './service.ts';
import { agentEditorSession } from './session.ts';
import { AgentTextDocumentManager } from './textDocumentManager.ts';
import { AgentUrlOpener } from './urlOpener.ts';
import { AgentWorkspaceWatcherProvider } from './workspaceWatcher/agentWatcherProvider.ts';
import { AuthPersistence } from '../../lib/src/auth/authPersistence.ts';
import { CopilotTokenManager } from '../../lib/src/auth/copilotTokenManager.ts';
import { GitHubDeviceFlow } from '../../lib/src/auth/deviceFlow.ts';
import { AuthManager } from '../../lib/src/auth/manager.ts';
import { CitationManager } from '../../lib/src/citationManager.ts';
import { createProductionContext } from '../../lib/src/common/productContext.ts';
import { BuildInfo, EditorAndPluginInfo, EditorSession } from '../../lib/src/config.ts';
import { CopilotContentExclusionManager } from '../../lib/src/contentExclusion/contentExclusionManager.ts';
import { ChatMLFetcher } from '../../lib/src/conversation/chatMLFetcher.ts';
import { EditProgressReporter } from '../../lib/src/copilotEdits/progress/editProgressReporter.ts';
import { CopilotEditsService } from '../../lib/src/copilotEdits/services/copilotEditsService.ts';
import { EditConversations } from '../../lib/src/copilotEdits/services/editConversations.ts';
import { registerDefaultHandlers } from '../../lib/src/defaultHandlers.ts';
import { DefaultNetworkConfiguration } from '../../lib/src/defaultNetworkConfiguration.ts';
import { setupExperimentationService } from '../../lib/src/experiments/defaultExpFilters.ts';
import { FileReader } from '../../lib/src/fileReader.ts';
import { FileSystem } from '../../lib/src/fileSystem.ts';
import { NetworkConfiguration } from '../../lib/src/networkConfiguration.ts';
import { Fetcher } from '../../lib/src/networking.ts';
import { NotificationSender } from '../../lib/src/notificationSender.ts';
import { PersistenceManager, makeXdgPersistenceManager } from '../../lib/src/persist.ts';
import { StatusReporter } from '../../lib/src/progress.ts';
import { ContextProviderRegistry, getContextProviderRegistry } from '../../lib/src/prompt/contextProviderRegistry.ts';
import { ContextProviderStatistics } from '../../lib/src/prompt/contextProviderStatistics.ts';
import { RelatedFilesProvider } from '../../lib/src/prompt/similarFiles/relatedFiles.ts';
import { TextDocumentManager } from '../../lib/src/textDocumentManager.ts';
import { createConsole } from '../../lib/src/util/console.ts';
import { UrlOpener } from '../../lib/src/util/opener.ts';
import { WorkspaceWatcherProvider } from '../../lib/src/workspaceWatcherProvider.ts';
import { default as yargs } from 'yargs';

// import { tmpdir } from 'node:os';
// import { mkdtemp } from 'node:fs/promises';
// import { hideBin } from 'yargs/helpers';
import type { Connection, MessageReader, MessageWriter } from 'vscode-languageserver/node.js';
import type { Context } from '../../lib/src/context.ts';

export const createLanguageServerContext = (connection: Connection): Context => {
  const configProvider = new AgentConfigProvider(process.env);
  const ctx = createProductionContext(configProvider);
  ctx.set(AgentConfigProvider, configProvider);
  ctx.set(CopilotCapabilitiesProvider, new CopilotCapabilitiesProvider());
  ctx.set(InitializedNotifier, new InitializedNotifier());
  ctx.set(Fetcher, new AgentDelegatingFetcher(ctx));
  ctx.set(ChatMLFetcher, new ChatMLFetcher(ctx));
  applyHttpConfiguration(ctx, {});
  const persistenceManager = makeXdgPersistenceManager();
  ctx.set(PersistenceManager, persistenceManager);
  const tokenManager = new AgentCopilotTokenManager(ctx);
  ctx.set(CopilotTokenManager, tokenManager), ctx.set(AgentCopilotTokenManager, tokenManager);
  const authPersistence = new AuthPersistence(ctx, persistenceManager);
  ctx.set(AuthPersistence, authPersistence);
  ctx.set(AuthManager, new AuthManager(authPersistence, tokenManager));
  ctx.set(GitHubDeviceFlow, new GitHubDeviceFlow());
  ctx.set(EditorSession, agentEditorSession);
  ctx.set(EditorAndPluginInfo, new AgentEditorInfo());
  ctx.set(MethodHandlers, getAllMethods());
  ctx.set(CopilotCompletionCache, new CopilotCompletionCache());
  ctx.set(FileSystem, agentFileSystem);
  ctx.set(RelatedFilesProvider, new AgentRelatedFilesProvider(ctx));
  ctx.set(WorkspaceWatcherProvider, new AgentWorkspaceWatcherProvider(ctx));
  ctx.set(LspFileWatcher, new LspFileWatcher(ctx));
  ctx.set(ContextProviderStatistics, new ContextProviderStatistics());
  ctx.set(ContextProviderRegistry, getContextProviderRegistry(ctx, match));
  registerDefaultHandlers(ctx);
  ctx.set(Service, new Service(ctx, connection));
  ctx.set(NotificationSender, new ConnectionNotificationSender(ctx));
  ctx.set(UrlOpener, new AgentUrlOpener(ctx));
  ctx.set(StatusReporter, new NotificationStatusReporter(ctx));
  ctx.set(FeatureFlagsNotifier, new FeatureFlagsNotifier(ctx));
  const tdm = new AgentTextDocumentManager(ctx);
  ctx.set(TextDocumentManager, tdm);
  ctx.set(AgentTextDocumentManager, tdm);
  ctx.set(FileReader, new FileReader(ctx));
  ctx.set(NetworkConfiguration, new DefaultNetworkConfiguration(ctx));
  ctx.set(CopilotContentExclusionManager, new CopilotContentExclusionManager(ctx));
  activateConversationFeature(ctx);
  setupExperimentationService(ctx);
  ctx.set(ProgressTokens, new ProgressTokens());
  ctx.set(ExternalTestingCompletionDocuments, new ExternalTestingCompletionDocuments());
  ctx.set(ExternalTestingPanelCompletionDocuments, new ExternalTestingPanelCompletionDocuments());
  ctx.set(CitationManager, new CLSCitationManager());
  ctx.set(CopilotEditsMockManager, new CopilotEditsMockManager());
  ctx.set(CopilotEditsService, new CopilotEditsService(ctx));
  ctx.set(EditConversations, new EditConversations(ctx));
  ctx.set(EditProgressReporter, new AgentEditProgressReporter(ctx));
  ctx.set(CopilotEditsExceptionHandler, new CopilotEditsExceptionHandler(ctx));
  return ctx;
};

const main = async (): Promise<void> => {
  const builder = yargs(process.argv.slice(2))
    .version(new BuildInfo().getDisplayVersion())
    .strict()
    .option('debug', { type: 'boolean', hidden: true })
    .option('clientProcessId', { type: 'string', hidden: true })
    .option('stdio', { type: 'boolean', describe: 'Use stdio' });

  if (!('pkg' in process)) {
    builder.option('node-ipc', { type: 'boolean', describe: 'Use node IPC', conflicts: 'stdio' });
  }

  const args = await builder.parse();
  let reader: MessageReader;
  let writer: MessageWriter;

  if (args['node-ipc']) {
    reader = new IPCMessageReader(process);
    writer = new IPCMessageWriter(process);
  } else if (args.stdio) {
    reader = new StreamMessageReader(process.stdin);
    writer = new StreamMessageWriter(process.stdout);
  } else {
    console.error("error: required option '--stdio' not specified");
    process.exit(1);
  }

  if ('pkg' in process && process.platform !== 'win32') {
    process.env.TMPDIR = await fs.mkdtemp(`${os.tmpdir()}/github-copilot-`);
  }

  const conn = createConnection(ProposedFeatures.all, ...(await wrapTransports(process.env, reader, writer)));

  const ctx = createLanguageServerContext(conn);
  console = createConsole(ctx);
  const service = ctx.get(Service);

  reader.onClose(() => service.onExit());
  process.on('SIGINT', () => {
    service
      .onExit()
      .finally(() => process.exit(130))
      .catch(() => {});
  });

  process.on('SIGTERM', () => {
    service
      .onExit()
      .finally(() => process.exit(143))
      .catch(() => {});
  });

  service.listen();
};

export { main };
