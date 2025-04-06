import type { DocumentUri, WorkspaceFolder } from 'vscode-languageserver-types';
import type {
  WorkspaceFoldersChangeEvent,
  TextDocuments,
  WorkspaceFolder as LSPWorkspaceFolder,
  NotificationHandler,
  NotebookCell,
  Disposable,
} from 'vscode-languageserver/node.js';
import type { Context } from '../../lib/src/context.ts';
import type { FileSystem } from '../../lib/src/fileSystem.ts';
import type { INotebook } from '../../lib/src/textDocumentManager.ts';

import { EventEmitter } from 'node:events';
import { NotebookDocuments, TextDocumentContentChangeEvent as LspEvent } from 'vscode-languageserver/node.js';
import { Service } from './service.ts';
import { Logger } from '../../lib/src/logger.ts';
import { TextDocumentManager } from '../../lib/src/textDocumentManager.ts';
import { CopilotTextDocument } from '../../lib/src/textDocument.ts';
import { normalizeUri } from '../../lib/src/util/uri.ts';
import { DidFocusTextDocumentNotification } from '../../types/src/didFocusTextDocument.ts';
import type {} from '../../types/src/index.ts';

const configLogger = new Logger('AgentTextDocumentConfiguration');

class AgentTextDocumentsConfiguration {
  readonly emitter = new EventEmitter<{ change: [TextDocumentManager.DidChangeTextDocumentParams] }>();

  constructor(readonly ctx: Context) {}

  create(uri: string, languageId: string, version: number, content: string): CopilotTextDocument {
    try {
      return CopilotTextDocument.create(uri, languageId, version, content);
    } catch (e) {
      throw (configLogger.exception(this.ctx, e, '.create'), e);
    }
  }

  update(document: CopilotTextDocument, changes: LspEvent[], version: number): CopilotTextDocument {
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
      return CopilotTextDocument.withChanges(document, changes, version);
    } catch (e) {
      throw (configLogger.exception(this.ctx, e, '.update'), e);
    }
  }
}

class AgentTextDocumentManager extends TextDocumentManager {
  readonly _documents = new Map();
  readonly workspaceFolders: WorkspaceFolder[] = [];
  readonly _textDocumentConfiguration = new AgentTextDocumentsConfiguration(this.ctx);
  readonly _notebookDocuments = new NotebookDocuments(this._textDocumentConfiguration);

  constructor(ctx: Context) {
    super(ctx);
  }

  // EDITED this.onDidChangeTextDocument = (listener, thisArgs, disposables) =>
  // caller should just bind listener with its `this` itself
  onDidChangeTextDocument(listener: NotificationHandler<TextDocumentManager.DidChangeTextDocumentParams>): Disposable {
    this._textDocumentConfiguration.emitter.on('change', listener);
    return {
      dispose: () => {
        this._textDocumentConfiguration.emitter.removeListener('change', listener);
      },
    };
  }

  // EDITED this.onDidFocusTextDocument = (listener, thisArgs, disposables)
  // caller should just bind listener with its `this` itself
  onDidFocusTextDocument(
    listener: NotificationHandler<TextDocumentManager.DidFocusTextDocumentParams | undefined>
  ): Disposable {
    return this.connection.onNotification(DidFocusTextDocumentNotification.type, (event) => {
      const document = ('textDocument' in event ? event.textDocument : event) ?? {};
      listener('uri' in document ? { document } : undefined);
    });
  }

  get connection() {
    return this.ctx.get(Service).connection;
  }

  init(workspaceFolders: WorkspaceFolder[]) {
    this.connection.onDidOpenTextDocument((event) => {
      let td = event.textDocument;
      let document = this._textDocumentConfiguration.create(td.uri, td.languageId, td.version, td.text);
      this._documents.set(normalizeUri(td.uri), document);
    });

    this.connection.onDidChangeTextDocument((event) => {
      const td = event.textDocument;
      const changes = event.contentChanges;
      const { version: version } = td;
      if (version == null)
        throw new Error(`Received document change event for ${td.uri} without valid version identifier`);
      const uri = normalizeUri(td.uri);
      let syncedDocument = this._documents.get(uri);

      if (syncedDocument !== undefined) {
        syncedDocument = this._textDocumentConfiguration.update(syncedDocument, changes, version);
        this._documents.set(uri, syncedDocument);
      }
    });

    this.connection.onDidCloseTextDocument((event) => {
      let uri = normalizeUri(event.textDocument.uri);
      this._documents.delete(uri);
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
    return [...this._documents.values()];
  }

  getOpenTextDocument(docId: { uri: DocumentUri }) {
    return this._documents.get(normalizeUri(docId.uri));
  }

  getWorkspaceFolders(): WorkspaceFolder[] {
    return this.workspaceFolders;
  }
  findNotebook(doc: CopilotTextDocument): INotebook | undefined {
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
