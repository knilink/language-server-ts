import { EventEmitter } from 'node:events';
import {
  NotebookDocuments,
  TextDocumentContentChangeEvent as LspEvent,
  WorkspaceFoldersChangeEvent,
  TextDocuments,
  WorkspaceFolder as LSPWorkspaceFolder,
  NotificationHandler,
  NotebookCell,
} from 'vscode-languageserver';
// import { Disposable } from 'vscode-jsonrpc';

import { Context } from '../../lib/src/context.ts';
import { TextDocument } from '../../lib/src/textDocument.ts';
import { Service } from './service.ts';
import { FileSystem } from '../../lib/src/fileSystem.ts';
import { Logger, LogLevel } from '../../lib/src/logger.ts';
import { INotebook, TextDocumentManager } from '../../lib/src/textDocumentManager.ts';
// import { Document } from '../../prompt/src/types';
import { DocumentUri, WorkspaceFolder } from 'vscode-languageserver-types';

const configLogger = new Logger(LogLevel.DEBUG, 'AgentTextDocumentConfiguration');

class AgentTextDocumentsConfiguration {
  readonly emitter = new EventEmitter<{ change: [TextDocumentManager.DidChangeTextDocumentParams] }>();

  constructor(readonly ctx: Context) {}

  create(uri: string, languageId: string, version: number, content: string): TextDocument {
    try {
      return TextDocument.create(uri, languageId, version, content);
    } catch (e) {
      throw (configLogger.exception(this.ctx, e, '.create'), e);
    }
  }

  update(document: TextDocument, changes: LspEvent[], version: number): TextDocument {
    try {
      const updates = [];
      for (let change of changes)
        if (LspEvent.isIncremental(change)) {
          let update = {
            range: change.range,
            rangeOffset: document.offsetAt(change.range.start),
            rangeLength: document.offsetAt(change.range.end) - document.offsetAt(change.range.start),
            text: change.text,
          };
          updates.push(update);
        }
      let event = { document: document, contentChanges: updates };
      this.emitter.emit('change', event);
      return TextDocument.withChanges(document, changes, version);
    } catch (e) {
      throw (configLogger.exception(this.ctx, e, '.update'), e);
    }
  }
}

class AgentTextDocumentManager extends TextDocumentManager {
  readonly workspaceFolders: WorkspaceFolder[] = [];
  readonly _textDocumentConfiguration = new AgentTextDocumentsConfiguration(this.ctx);
  readonly _textDocumentListener = new TextDocuments(this._textDocumentConfiguration);
  readonly _notebookDocuments = new NotebookDocuments(this._textDocumentListener);

  constructor(ctx: Context) {
    super(ctx);
  }

  // EDITED
  onDidChangeTextDocument(listener: NotificationHandler<TextDocumentManager.DidChangeTextDocumentParams>) {
    this._textDocumentConfiguration.emitter.on('change', listener);
    return {
      dispose: () => {
        this._textDocumentConfiguration.emitter.removeListener('change', listener);
      },
    };
  }

  // EDITED this.onDidFocusTextDocument = (listener, thisArgs, disposables)
  onDidFocusTextDocument(listener: NotificationHandler<TextDocumentManager.DidFocusTextDocumentParams>) {
    return this.connection.onNotification('textDocument/didFocus', (event) => {
      let uri = event.textDocument?.uri ?? event.uri;
      listener({ document: { uri: uri } });
    });
  }

  onDidChangeCursor(listener: NotificationHandler<unknown>) {
    return {
      dispose: () => {},
    };
  }

  get connection() {
    return this.ctx.get(Service).connection;
  }

  init(workspaceFolders: WorkspaceFolder[]) {
    this._textDocumentListener.listen(this.connection);
    this.connection.onDidChangeTextDocument((event) => {
      const td = event.textDocument;
      const changes = event.contentChanges;
      const { version: version } = td;
      if (version == null)
        throw new Error(`Received document change event for ${td.uri} without valid version identifier`);
      const that: any = this._textDocumentListener;
      // MARK private _syncedDocuments
      let syncedDocument = that._syncedDocuments.get(td.uri);

      if (syncedDocument !== undefined) {
        syncedDocument = this._textDocumentConfiguration.update(syncedDocument, changes, version);
        // MARK private _syncedDocuments
        that._syncedDocuments.set(td.uri, syncedDocument);
        // MARK private _onDidChangeContent
        that._onDidChangeContent.fire(Object.freeze({ document: syncedDocument }));
      }
    });
    this._notebookDocuments.listen(this.connection);
    this.workspaceFolders.length = 0;
    this.workspaceFolders.push(...workspaceFolders);
  }
  didChangeWorkspaceFolders(event: WorkspaceFoldersChangeEvent) {
    event.added.forEach((c) => this.registerWorkspaceFolder(c));
    event.removed.forEach((c) => this.unregisterWorkspaceFolder(c));
  }
  unregisterWorkspaceFolder(container: LSPWorkspaceFolder) {
    const index = this.workspaceFolders.findIndex((f) => f.uri === container.uri);

    if (index >= 0) {
      this.workspaceFolders.splice(index, 1);
    }
  }
  registerWorkspaceFolder(container: WorkspaceFolder) {
    this.workspaceFolders.push(container);
  }
  getOpenTextDocuments() {
    return this._textDocumentListener.all();
  }
  async openTextDocument(uri: DocumentUri): Promise<TextDocument | undefined> {
    try {
      if ((await this.ctx.get(FileSystem).stat(uri)).size > 5 * 1024 * 1024) return;
    } catch {
      return;
    }
    const text = await this.ctx.get(FileSystem).readFileString(uri);
    return TextDocument.create(uri, 'UNKNOWN', 0, text);
  }
  getWorkspaceFolders(): WorkspaceFolder[] {
    return this.workspaceFolders;
  }
  findNotebook(doc: TextDocument): INotebook | undefined {
    let notebook = this._notebookDocuments.findNotebookDocumentForCell(doc.uri);
    if (notebook)
      return {
        getCells: () => notebook.cells.map((cell, index) => this.wrapCell(cell, index)).filter((c) => !!c),
        getCellFor: ({ uri }) => {
          let index = notebook.cells.findIndex((cell) => cell.document === uri);
          return index !== -1 ? this.wrapCell(notebook.cells[index], index) : undefined;
        },
      };
  }
  wrapCell(cell: NotebookCell, index: number) {
    let document = this._notebookDocuments.getCellTextDocument(cell);
    if (document) return { kind: cell.kind, metadata: cell.metadata ?? {}, index, document };
  }
}

export { AgentTextDocumentsConfiguration, AgentTextDocumentManager };
