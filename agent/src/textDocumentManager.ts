import { URI } from 'vscode-uri';
import {
  TextDocumentContentChangeEvent,
  WorkspaceFoldersChangeEvent,
  TextDocuments,
  WorkspaceFolder as LSPWorkspaceFolder,
  NotificationHandler,
} from 'vscode-languageserver';
import { TextDocument as LSPTextDocument, Range } from 'vscode-languageserver-textdocument';
// import { Disposable } from 'vscode-jsonrpc';

import { Context } from '../../lib/src/context.ts';
import { LanguageDetection } from '../../lib/src/language/languageDetection.ts';
import { TextDocument } from '../../lib/src/textDocument.ts';
import { Service } from './service.ts';
import { FileSystem } from '../../lib/src/fileSystem.ts';
import { EventEmitter } from 'node:events';
import { INotebook, TextDocumentManager } from '../../lib/src/textDocumentManager.ts';
// import { Document } from '../../prompt/src/types';
import { WorkspaceFolder } from '../../lib/src/types.ts';

function wrapDoc(ctx: Context, doc: TextDocument): TextDocument {
  const languageDetection = ctx.get<LanguageDetection>(LanguageDetection);
  const language = languageDetection.detectLanguage(
    TextDocument.create(doc.uri, doc.languageId, doc.version, doc.getText())
  );
  return TextDocument.create(doc.uri, language.languageId, doc.version, doc.getText());
}

class AgentTextDocumentsConfiguration {
  readonly emitter = new EventEmitter<{ change: [TextDocumentManager.DidChangeTextDocumentParams] }>();

  constructor(readonly ctx: Context) {}

  create(uri: string, languageId: string, version: number, content: string): LSPTextDocument {
    const doc = TextDocument.create(URI.parse(uri), languageId, version, content);
    const language = this.ctx.get(LanguageDetection).detectLanguage(doc);
    return TextDocument.create(URI.parse(uri), language.languageId, version, content).lspTextDocument;
  }

  update(document: TextDocument, changes: TextDocumentContentChangeEvent[], version: number): LSPTextDocument {
    const updates = [];

    for (const change of changes) {
      if (TextDocumentContentChangeEvent.isIncremental(change)) {
        const update = {
          range: change.range,
          rangeOffset: document.offsetAt(change.range.start),
          rangeLength: document.offsetAt(change.range.end) - document.offsetAt(change.range.start),
          text: change.text,
        };
        updates.push(update);
      }
    }

    const agentTextDocument = wrapDoc(this.ctx, document);
    const event = { document: agentTextDocument, contentChanges: updates };
    this.emitter.emit('change', event);
    agentTextDocument['update'](changes, version);
    return agentTextDocument.lspTextDocument;
  }
}

class AgentTextDocumentManager extends TextDocumentManager {
  readonly workspaceFolders: WorkspaceFolder[] = [];
  private _textDocumentConfiguration = new AgentTextDocumentsConfiguration(this.ctx);
  private _textDocumentListener = new TextDocuments(this._textDocumentConfiguration);

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

  // EDITED
  onDidFocusTextDocument(listener: NotificationHandler<TextDocumentManager.DidFocusTextDocumentParams>) {
    this.connection.onNotification('textDocument/didFocus', (event) => {
      const uri = URI.parse(event.textDocument?.uri ?? event.uri);
      listener({ document: { uri } });
    });
    return { dispose: () => {} };
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
    this.workspaceFolders.length = 0;
    this.workspaceFolders.push(...workspaceFolders);
  }
  didChangeWorkspaceFolders(event: WorkspaceFoldersChangeEvent) {
    event.added.forEach((c) => this.registerWorkspaceFolder(c));
    event.removed.forEach((c) => this.unregisterWorkspaceFolder(c));
  }
  unregisterWorkspaceFolder(container: LSPWorkspaceFolder) {
    let index = this.workspaceFolders.findIndex((f) => f.toString() === URI.parse(container.uri).toString());
    if (index >= 0) {
      this.workspaceFolders.splice(index, 1);
    }
  }
  registerWorkspaceFolder(container: LSPWorkspaceFolder) {
    this.workspaceFolders.push(URI.parse(container.uri));
  }
  getOpenTextDocuments() {
    return this._textDocumentListener.all().map((doc) => TextDocument.wrap(doc));
  }
  async openTextDocument(uri: URI): Promise<TextDocument | undefined> {
    try {
      if ((await this.ctx.get(FileSystem).stat(uri)).size > 5 * 1024 * 1024) return;
    } catch {
      return;
    }
    const text = await this.ctx.get(FileSystem).readFileString(uri);
    const tmpDoc = TextDocument.create(uri, 'UNKNOWN', 0, text);
    const language = this.ctx.get(LanguageDetection).detectLanguage(tmpDoc);
    return TextDocument.create(uri, language.languageId, 0, text);
  }
  getWorkspaceFolders(): WorkspaceFolder[] {
    return this.workspaceFolders;
  }
  findNotebook(doc: TextDocument): INotebook | void {}
}

export { AgentTextDocumentsConfiguration, AgentTextDocumentManager };
