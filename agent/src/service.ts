import type { Context } from '../../lib/src/context.ts';
import type { CopilotInitializationOptionsType } from '../../types/src/index.ts';

import * as semver from 'semver';
import { ResponseError, TextDocumentSyncKind } from '../../node_modules/vscode-languageserver/node.js';
import { registerCommands } from './commands/index.ts';
import { hasValidInfo } from './config.ts';
import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { InitializedNotifier } from './editorFeatures/initializedNotifier.ts';
import { NotificationLogger } from './editorFeatures/logTarget.ts';
import { setupRedirectingTelemetryReporters } from './editorFeatures/redirectTelemetryReporter.ts';
import { AgentInstallationManager } from './installationManager.ts';
import { LspFileWatcher } from './lspFileWatcher.ts';
import { MethodHandlers } from './methods/methods.ts';
import {
  externalSections,
  initializePostConfigurationDependencies,
  notifyChangeConfiguration,
} from './methods/notifyChangeConfiguration.ts';
import { registerNotifications } from './notifications/index.ts';
import { ErrorCode } from './rpc.ts';
import { SchemaValidationError } from './schemaValidation.ts';
import { AgentTextDocumentManager } from './textDocumentManager.ts';
import { CopilotAuthError } from '../../lib/src/auth/error.ts';
import { AuthManager } from '../../lib/src/auth/manager.ts';
import { BuildInfo, EditorAndPluginInfo, GitHubAppInfo } from '../../lib/src/config.ts';
import { registerDocumentTracker } from '../../lib/src/documentTracker.ts';
import { rejectLastShown } from '../../lib/src/ghostText/last.ts';
import { LogTarget, Logger } from '../../lib/src/logger.ts';
import { tryHeatingUpTokenizer } from '../../lib/src/prompt/components/completionsPrompt.tsx';
import { TelemetryReporters, telemetryCatch } from '../../lib/src/telemetry.ts';
import { PromiseQueue } from '../../lib/src/util/promiseQueue.ts';
import { WorkspaceNotifier } from '../../lib/src/workspaceNotifier.ts';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { CopilotInitializationOptions } from '../../types/src/initialize.ts';
import type {} from '../../types/src/index.ts';

import {
  CancellationToken,
  Connection,
  WorkspaceFoldersChangeEvent,
  DidChangeConfigurationParams,
  LSPAny,
  InitializeParams,
} from 'vscode-languageserver/node.js';

const optionsTypeCheck = TypeCompiler.Compile(CopilotInitializationOptions);

// MARK either void or not mutating
function purgeNulls(obj: any): any {
  if (obj !== null) {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        obj[i] = purgeNulls(obj[i]);
      }
    } else if (typeof obj === 'object') {
      const record = obj;
      for (let key in record) {
        if (record[key] === null) {
          delete record[key];
        } else {
          record[key] = purgeNulls(record[key]);
        }
      }
    }
    return obj;
  }
}

class Service {
  private initialized: boolean = false;
  private _shutdown?: Promise<void>;
  private _clientCapabilities?: InitializeParams['capabilities'];
  private _originalLogTarget?: LogTarget;
  installationTelemetryTimer?: NodeJS.Timeout;

  constructor(
    readonly ctx: Context,
    readonly connection: Connection
  ) {
    this._originalLogTarget = this.ctx.get(LogTarget);
  }

  // ./urlOpener.ts
  get clientCapabilities() {
    return this._clientCapabilities;
  }

  listen() {
    const ctx = this.ctx;
    const connection = this.connection;

    connection.onRequest((method: string, params: unknown, token: CancellationToken) =>
      this.messageHandler(method, params, token)
    );
    registerNotifications(ctx, connection);

    const serverInfo = {
      name: 'GitHub Copilot Language Server',
      version: ctx.get(BuildInfo).getDisplayVersion(),
      nodeVersion: process.versions.node,
    };
    let workspaceConfiguration: any;

    const didChangeConfiguration = async (params: Partial<DidChangeConfigurationParams>) => {
      try {
        if (workspaceConfiguration && params && typeof params === 'object' && !('settings' in params)) {
          const sections = await connection.workspace.getConfiguration(
            ['github.copilot', ...externalSections].map((section) => ({ section }))
          );
          const settings: LSPAny = { github: { copilot: sections.shift() } };
          for (const section of externalSections) settings[section] = sections.shift();
          params.settings = settings;
        }
        return notifyChangeConfiguration(ctx, purgeNulls(params));
      } catch (e) {
        logger.exception(ctx, e, 'didChangeConfiguration');
      }
    };

    function didChangeWorkspaceFolders(params: WorkspaceFoldersChangeEvent) {
      try {
        ctx.get(AgentTextDocumentManager).didChangeWorkspaceFolders(params);
        ctx.get(WorkspaceNotifier).emit(params);
      } catch (e) {
        logger.exception(ctx, e, 'didChangeWorkspaceFolders');
      }
    }

    this.connection.onNotification('vs/didAddWorkspaceFolder', ({ name, uri }) =>
      didChangeWorkspaceFolders({ added: [{ uri, name: name ?? uri }], removed: [] })
    );

    this.connection.onNotification('vs/didRemoveWorkspaceFolder', ({ name, uri }) =>
      didChangeWorkspaceFolders({ added: [], removed: [{ uri, name: name ?? uri }] })
    );

    connection.onInitialize(async (params: InitializeParams) => {
      if (this.initialized) throw new Error('initialize request sent after initialized notification');
      this._clientCapabilities = params.capabilities;
      let copilotCapabilities: CopilotInitializationOptionsType['copilotCapabilities'] = (params.capabilities as any)
        .copilot;
      const maybeOptions = purgeNulls(params.initializationOptions);
      if (maybeOptions) {
        if (!optionsTypeCheck.Check(maybeOptions)) {
          throw new SchemaValidationError(optionsTypeCheck.Errors(maybeOptions));
        }
        const options = maybeOptions;
        const editorAndPluginInfo = ctx.get(EditorAndPluginInfo);

        if (options.editorPluginInfo) {
          editorAndPluginInfo.setEditorAndPluginInfo(
            options.editorPluginInfo,
            options.editorInfo,
            options.relatedPluginInfo ?? []
          );
        } else {
          logger.warn(
            ctx,
            'editorInfo and editorPluginInfo will soon be required in initializationOptions. This will replace setEditorInfo.'
          );
        }

        if (options.copilotIntegrationId) {
          editorAndPluginInfo.setCopilotIntegrationId(options.copilotIntegrationId);
        }

        if (options.githubAppId) {
          ctx.get(GitHubAppInfo).githubAppId = options.githubAppId;
        }

        if (options.copilotCapabilities) {
          copilotCapabilities = options.copilotCapabilities;
        }
      }
      let clientWorkspace = params.capabilities.workspace?.workspaceFolders ?? false;

      ctx.get(AgentTextDocumentManager).init(params.workspaceFolders ?? []);
      registerDocumentTracker(this.ctx);
      ctx.get(WorkspaceNotifier).emit({ added: params.workspaceFolders ?? [], removed: [] });
      workspaceConfiguration = params.capabilities.workspace?.configuration;
      if (copilotCapabilities) {
        ctx.get(CopilotCapabilitiesProvider).setCapabilities(copilotCapabilities);
      }

      const onInitialized = async () => {
        if (!this.initialized) {
          this.initialized = true;
          logger.info(ctx, `${serverInfo.name} ${serverInfo.version} initialized`);

          if (clientWorkspace) {
            connection.workspace.onDidChangeWorkspaceFolders(didChangeWorkspaceFolders);
          }

          if (workspaceConfiguration) {
            await didChangeConfiguration({});
          } else {
            await initializePostConfigurationDependencies(ctx);
          }

          this.installationTelemetryTimer = setTimeout(() => {
            new AgentInstallationManager().startup(ctx).catch(() => {});
          }, 1e3);

          ctx.get(InitializedNotifier).emit();
          tryHeatingUpTokenizer(ctx);
        }
      };
      connection.onInitialized(telemetryCatch(ctx, onInitialized, 'onInitialized'));
      ctx.get(LspFileWatcher).init();

      if (copilotCapabilities?.token) {
        ctx.get(AuthManager).setTransientAuthRecord(ctx, null);
      }

      if (copilotCapabilities?.redirectedTelemetry) {
        await setupRedirectingTelemetryReporters(ctx);
      }

      if (semver.lt(process.versions.node, '18.5.0')) {
        logger.warn(
          ctx,
          `Node.js ${process.versions.node} support is deprecated. Please upgrade to Node.js 20 or newer.`
        );
      }
      return {
        capabilities: {
          textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental },
          notebookDocumentSync: { notebookSelector: [{ notebook: '*' }] },
          workspace: {
            workspaceFolders: { supported: clientWorkspace, changeNotifications: clientWorkspace },
          },
          executeCommandProvider: { commands: registerCommands(ctx, connection) },
          inlineCompletionProvider: {},
        },
        serverInfo: serverInfo,
      };
    });

    connection.onShutdown(async () => {
      this._shutdown ??= this.deactivate();
      await this._shutdown;
    });

    connection.onExit(() => void this.onExit());
    connection.onDidChangeConfiguration(telemetryCatch(ctx, didChangeConfiguration, 'onDidChangeConfiguration'));
    connection.listen();

    const notificationLogTarget = new NotificationLogger();
    this.ctx.forceSet(LogTarget, notificationLogTarget);
  }

  async messageHandler(method: string, params: unknown, token: CancellationToken): Promise<any> {
    const handler = this.ctx.get(MethodHandlers).handlers.get(method);
    if (!handler) {
      return new ResponseError(ErrorCode.MethodNotFound, `Method not found: ${method}`);
    }
    if (!this.initialized) {
      return new ResponseError(ErrorCode.ServerNotInitialized, 'Agent service not initialized.');
    }
    if (this._shutdown) {
      return new ResponseError(ErrorCode.InvalidRequest, 'Agent service shut down.');
    }
    if (method !== 'setEditorInfo' && !hasValidInfo(this.ctx.get(EditorAndPluginInfo))) {
      throw new ResponseError(
        ErrorCode.ServerNotInitialized,
        'editorInfo and editorPluginInfo not set in initializationOptions'
      );
    }

    if (Array.isArray(params)) {
      params = params[0];
    }
    purgeNulls(params);

    try {
      const [maybeResult, maybeErr] = await handler(this.ctx, token, params);
      return maybeErr ? new ResponseError(maybeErr.code, maybeErr.message, (maybeErr as any).data) : maybeResult;
    } catch (e: any) {
      if (token.isCancellationRequested) {
        return new ResponseError(ErrorCode.RequestCancelled, 'Request was canceled');
      }
      if (e instanceof CopilotAuthError) {
        return new ResponseError(ErrorCode.NoCopilotToken, `Not authenticated: ${e.message}`);
      }

      if (!(e instanceof ResponseError)) {
        logger.exception(this.ctx, e, `Request ${method}`);
      }

      throw e;
    }
  }

  async onExit() {
    this.ctx.forceSet(LogTarget, this._originalLogTarget);
    this._shutdown ??= this.deactivate();
    await this._shutdown;
  }

  async deactivate() {
    const ctx = this.ctx;
    clearTimeout(this.installationTelemetryTimer);
    rejectLastShown(ctx);
    await Promise.race([new Promise((resolve) => setTimeout(resolve, 100)), ctx.get(PromiseQueue).flush()]);

    await Promise.race([new Promise((resolve) => setTimeout(resolve, 1800)), ctx.get(TelemetryReporters).deactivate()]);
  }

  dispose() {
    clearTimeout(this.installationTelemetryTimer);
    this.connection.dispose();
  }
}

const logger = new Logger('lsp');
export { Service, purgeNulls, logger };
