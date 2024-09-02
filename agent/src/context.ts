import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { default as Argv } from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  createConnection,
  ProposedFeatures,
  Connection,
  IPCMessageReader,
  IPCMessageWriter,
  StreamMessageReader,
  StreamMessageWriter,
  MessageReader,
  MessageWriter,
} from 'vscode-languageserver/node.js';

import { createConsole } from '../../lib/src/util/console.ts';
import { makeXdgPersistenceManager, PersistenceManager } from '../../lib/src/persist.ts';
import { GitHubDeviceFlow } from '../../lib/src/auth/deviceFlow.ts';
import { CopilotContentExclusionManager } from '../../lib/src/contentExclusion/contentExclusionManager.ts';
import { WorkDoneProgressTokens } from './workDoneProgressTokens.ts';
import { DefaultNetworkConfiguration } from '../../lib/src/defaultNetworkConfiguration.ts';
import { CopilotTokenManager } from '../../lib/src/auth/copilotTokenManager.ts';
import { wrapTransports } from './debug.ts';
import { BuildInfo, EditorAndPluginInfo, EditorSession } from '../../lib/src/config.ts';
import { AgentConfigProvider, AgentEditorInfo } from './config.ts';
import { AuthPersistence } from '../../lib/src/auth/authPersistence.ts';
import { setupExperimentationService } from '../../lib/src/experiments/defaultExpFilters.ts';
import { AgentDelegatingFetcher } from './network/delegatingFetcher.ts';
import { activateConversationFeature } from './conversation/conversationFeature.ts';
import { FeatureFlagsNotifier } from './editorFeatures/featureFlagsNotifier.ts';
import { Service } from './service.ts';
import { Fetcher } from '../../lib/src/networking.ts';
import { FileSystem } from '../../lib/src/fileSystem.ts';
import { TextDocumentManager } from '../../lib/src/textDocumentManager.ts';
import { AgentRelatedFilesProvider } from './agentRelatedFilesProvider.ts';
import { NetworkConfiguration } from '../../lib/src/networkConfiguration.ts';
import { ConnectionNotificationSender } from './notificationSender.ts';
import { AgentUrlOpener } from './urlOpener.ts';
import { registerDefaultHandlers } from '../../lib/src/defaultHandlers.ts';
import { RelatedFilesProvider } from '../../lib/src/prompt/similarFiles/relatedFiles.ts';
import { StatusReporter } from '../../lib/src/progress.ts';
import { CopilotCompletionCache } from './copilotCompletionCache.ts';
import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { AgentWorkspaceWatcherProvider } from './workspaceWatcher/agentWatcherProvider.ts';
import { UrlOpener } from '../../lib/src/util/opener.ts';
import { AuthManager } from '../../lib/src/auth/manager.ts';
import { NotificationStatusReporter } from './editorFeatures/statusReporter.ts';
import { InitializedNotifier } from './editorFeatures/initializedNotifier.ts';
import { FileReader } from '../../lib/src/fileReader.ts';
import { agentFileSystem } from './fileSystem.ts';
import { AgentTextDocumentManager } from './textDocumentManager.ts';
import { NotificationSender } from '../../lib/src/notificationSender.ts';
import { getAllMethods, MethodHandlers } from './methods/methods.ts';
import { WorkspaceWatcherProvider } from '../../lib/src/workspaceWatcherProvider.ts';
import { agentEditorSession } from './session.ts';
import { applyHttpConfiguration } from './methods/notifyChangeConfiguration.ts';
import { AgentCopilotTokenManager } from './auth/copilotTokenManager.ts';
import { createProductionContext } from '../../lib/src/common/productContext.ts';
import { LspFileWatcher } from './lspFileWatcher.ts';

import { Context } from '../../lib/src/context.ts';

export const createLanguageServerContext = (connection: Connection): Context => {
  const configProvider = new AgentConfigProvider(process.env);
  const ctx = createProductionContext(configProvider);
  ctx.set(AgentConfigProvider, configProvider);
  ctx.set(CopilotCapabilitiesProvider, new CopilotCapabilitiesProvider());
  ctx.set(InitializedNotifier, new InitializedNotifier());
  ctx.set(Fetcher, new AgentDelegatingFetcher(ctx));
  applyHttpConfiguration(ctx, {});
  const persistenceManager = makeXdgPersistenceManager();
  ctx.set(PersistenceManager, persistenceManager);
  const tokenManager = new AgentCopilotTokenManager();
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
  registerDefaultHandlers(ctx);
  ctx.set(Service, new Service(ctx, connection));
  ctx.set(NotificationSender, new ConnectionNotificationSender(ctx));
  ctx.set(UrlOpener, new AgentUrlOpener(ctx));
  ctx.set(StatusReporter, new NotificationStatusReporter(ctx));
  ctx.set(FeatureFlagsNotifier, new FeatureFlagsNotifier(ctx));
  let tdm = new AgentTextDocumentManager(ctx);
  ctx.set(TextDocumentManager, tdm);
  ctx.set(AgentTextDocumentManager, tdm);
  ctx.set(FileReader, new FileReader(ctx));
  ctx.set(NetworkConfiguration, new DefaultNetworkConfiguration(ctx));
  ctx.set(CopilotContentExclusionManager, new CopilotContentExclusionManager(ctx));
  activateConversationFeature(ctx);
  setupExperimentationService(ctx);
  ctx.set(WorkDoneProgressTokens, new WorkDoneProgressTokens());
  return ctx;
};

const main = async (): Promise<void> => {
  const args = Argv(hideBin(process.argv))
    .version(new BuildInfo().getDisplayVersion())
    .option('stdio', { type: 'boolean', describe: 'use stdio' })
    .option('node-ipc', { type: 'boolean', describe: 'use node-ipc' })
    .parseSync();

  const isTTY = process.stdin.isTTY || process.stdout.isTTY;
  let reader: MessageReader;
  let writer: MessageWriter;

  if (args['node-ipc']) {
    reader = new IPCMessageReader(process);
    writer = new IPCMessageWriter(process);
  } else if (args.stdio || !isTTY) {
    reader = new StreamMessageReader(process.stdin);
    writer = new StreamMessageWriter(process.stdout);
  } else {
    console.error("error: required option '--stdio' not specified");
    process.exit(1);
  }

  if ('pkg' in process && process.platform !== 'win32') {
    process.env.TMPDIR = await mkdtemp(`${tmpdir()}/github-copilot-`);
  }

  const conn = createConnection(ProposedFeatures.all, ...wrapTransports(process.env, reader, writer));
  const ctx = createLanguageServerContext(conn);
  console = createConsole(ctx);
  const service = ctx.get(Service);

  reader.onClose(() => service.onExit());
  process.on('SIGINT', async () => {
    await service.onExit();
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    await service.onExit();
    process.exit(143);
  });

  service.listen();
};

export { main };
