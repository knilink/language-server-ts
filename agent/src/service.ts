import * as semver from 'semver';
import {
  CancellationToken,
  Connection,
  ResponseError,
  WorkspaceFoldersChangeEvent,
  WorkspaceFolder,
  DidChangeConfigurationParams,
  LSPAny,
  InitializedParams,
  InitializeParams,
  ClientCapabilities,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node.js';

import { TypeCompiler } from '@sinclair/typebox/compiler';

import type { Context } from '../../lib/src/context.ts';

import { registerCommands } from './commands/index.ts';
import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { InitializedNotifier } from './editorFeatures/initializedNotifier.ts';
import { NotificationLogger } from './editorFeatures/logTarget.ts';
import { setupRedirectingTelemetryReporters } from './editorFeatures/redirectTelemetryReporter.ts';
import { LspFileWatcher } from './lspFileWatcher.ts';
import { MethodHandlers } from './methods/methods.ts';
import { externalSections, notifyChangeConfiguration } from './methods/notifyChangeConfiguration.ts';
import { registerNotifications } from './notifications/index.ts';
import { SchemaValidationError } from './schemaValidation.ts';
import { AgentTextDocumentManager } from './textDocumentManager.ts';
import { CopilotAuthError } from '../../lib/src/auth/error.ts';
import { AuthManager } from '../../lib/src/auth/manager.ts';
import { BuildInfo, EditorAndPluginInfo, GitHubAppInfo } from '../../lib/src/config.ts';
import { registerDocumentTracker } from '../../lib/src/documentTracker.ts';
import { rejectLastShown } from '../../lib/src/ghostText/last.ts';
import { LogTarget, Logger, LogLevel } from '../../lib/src/logger.ts';
import { setupTelemetryReporters } from '../../lib/src/telemetry/setupTelemetryReporters.ts';
import { TelemetryReporters } from '../../lib/src/telemetry.ts';
import { PromiseQueue } from '../../lib/src/util/promiseQueue.ts';
import { WorkspaceNotifier } from '../../lib/src/workspaceNotifier.ts';
import { CopilotInitializationOptions, CopilotInitializationOptionsType } from '../../types/src/index.ts';

const optionsTypeCheck = TypeCompiler.Compile(CopilotInitializationOptions);

// MARK either void or not mutating
function purgeNulls(obj: any): any {
  if (obj !== null) {
    if (Array.isArray(obj)) for (let i = 0; i < obj.length; i++) obj[i] = purgeNulls(obj[i]);
    else if (typeof obj === 'object')
      for (const key in obj) {
        const value = obj[key];
        if (value === null) delete obj[key];
        else obj[key] = purgeNulls(obj[key]);
      }
    return obj;
  }
}

async function deactivate(ctx: Context): Promise<void> {
  rejectLastShown(ctx);
  await Promise.race([new Promise((resolve) => setTimeout(resolve, 100)), ctx.get(PromiseQueue).flush()]);
  await ctx.get(TelemetryReporters).deactivate();
}

class Service {
  private initialized: boolean = false;
  private _shutdown?: Promise<void>;
  private _clientCapabilities?: InitializeParams['capabilities'];
  private _originalLogTarget?: LogTarget;

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

    async function didChangeConfiguration(ctx: Context, params: Partial<DidChangeConfigurationParams>) {
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
    }

    async function didChangeWorkspaceFolders(params: WorkspaceFoldersChangeEvent) {
      try {
        ctx.get(AgentTextDocumentManager).didChangeWorkspaceFolders(params);
        ctx.get(WorkspaceNotifier).emit(params);
      } catch (e) {
        logger.exception(ctx, e, 'didChangeWorkspaceFolders');
      }
    }

    this.connection.onNotification('vs/didAddWorkspaceFolder', (c: WorkspaceFolder /* Container */) =>
      didChangeWorkspaceFolders({ added: [c], removed: [] })
    );
    this.connection.onNotification('vs/didRemoveWorkspaceFolder', (c: WorkspaceFolder /* Container */) =>
      didChangeWorkspaceFolders({ added: [], removed: [c] })
    );

    connection.onInitialize(async (params: InitializeParams) => {
      if (this.initialized) throw new Error('initialize request sent after initialized notification');
      this._clientCapabilities = params.capabilities;
      let copilotCapabilities: CopilotInitializationOptionsType['copilotCapabilities'] = (params.capabilities as any)
        .copilot;
      const options = purgeNulls(params.initializationOptions);
      if (options) {
        if (!optionsTypeCheck.Check(options)) throw new SchemaValidationError(optionsTypeCheck.Errors(options));
        if (options.editorInfo && options.editorPluginInfo) {
          ctx
            .get(EditorAndPluginInfo)
            .setEditorAndPluginInfo(options.editorInfo, options.editorPluginInfo, options.relatedPluginInfo ?? []);
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

      connection.onInitialized(async () => {
        if (this.initialized) return;
        this.initialized = true;
        logger.info(ctx, `${serverInfo.name} ${serverInfo.version} initialized`);
        if (clientWorkspace) {
          connection.workspace.onDidChangeWorkspaceFolders(didChangeWorkspaceFolders);
        }
        if (workspaceConfiguration) {
          await didChangeConfiguration(ctx, {});
        } else if (!copilotCapabilities?.redirectedTelemetry) {
          await setupTelemetryReporters(ctx, 'agent', true);
        }
        ctx.get(InitializedNotifier).emit();
      });
      ctx.get(LspFileWatcher).init();
      if (copilotCapabilities?.token) {
        await ctx.get(AuthManager).setTransientAuthRecord(ctx, null);
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
      this._shutdown ??= deactivate(this.ctx);
      await this._shutdown;
    });

    connection.onExit(() => this.onExit());
    connection.onDidChangeConfiguration(async (params: DidChangeConfigurationParams) => {
      await didChangeConfiguration(this.ctx, params);
    });
    connection.listen();

    const notificationLogTarget = new NotificationLogger();
    this.ctx.forceSet(LogTarget, notificationLogTarget);
  }

  async messageHandler(method: string, params: unknown, token: CancellationToken): Promise<any> {
    const handler = this.ctx.get(MethodHandlers).handlers.get(method);
    if (!handler) return new ResponseError(-32601, `Method not found: ${method} `);
    if (!this.initialized) return new ResponseError(-32002, 'Agent service not initialized.');
    if (this._shutdown) return new ResponseError(-32600, 'Agent service shut down.');

    if (Array.isArray(params)) {
      params = params[0];
    }
    purgeNulls(params);

    try {
      const [maybeResult, maybeErr] = await handler(this.ctx, token, params);
      return maybeErr ? new ResponseError(maybeErr.code, maybeErr.message, (maybeErr as any).data) : maybeResult;
    } catch (e: any) {
      if (token.isCancellationRequested) return new ResponseError(-32800, 'Request was canceled');
      if (e instanceof CopilotAuthError) return new ResponseError(1e3, `Not authenticated: ${e.message}`);
      throw (e instanceof ResponseError || logger.exception(this.ctx, e, `Request ${method} `), e);
    }
  }

  async onExit() {
    this.ctx.forceSet(LogTarget, this._originalLogTarget);
    this._shutdown ??= deactivate(this.ctx);
    await this._shutdown;
  }

  dispose() {
    this.connection.dispose();
  }
}

const logger = new Logger(LogLevel.DEBUG, 'lsp');
export { Service, purgeNulls, logger };
