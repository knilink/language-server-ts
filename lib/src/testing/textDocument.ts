import type { DocumentUri, WorkspaceFolder } from 'vscode-languageserver-types';
import type { LanguageId } from '../types.ts';
import type { Context } from '../context.ts';

import { TextDocumentManager, INotebook } from '../textDocumentManager.ts';
import { CopilotTextDocument } from '../textDocument.ts';
import { parseUri } from '../util/uri.ts';

function createTextDocument(uri: DocumentUri, clientAndDetectedLanguageId: string, version: number, text: string) {
  return CopilotTextDocument.create(
    parseUri(uri.toString(), true).toString(),
    clientAndDetectedLanguageId,
    version,
    text,
    clientAndDetectedLanguageId
  );
}

class SimpleTestTextDocumentManager extends TextDocumentManager {
  readonly _openTextDocuments: CopilotTextDocument[] = [];
  readonly _notebookDocuments = new Map<string, INotebook>();
  _workspaceFolders: WorkspaceFolder[] = [];
  readonly onDidFocusTextDocument = () => ({ dispose: () => {} });
  readonly onDidChangeTextDocument = () => ({ dispose: () => {} });

  constructor(ctx: Context) {
    super(ctx);
  }

  init(workspaceFolders: WorkspaceFolder[]) {
    this._workspaceFolders = workspaceFolders;
  }

  async openTextDocument(uri: DocumentUri) {
    return super.openTextDocument(uri);
  }

  getOpenTextDocuments() {
    return this._openTextDocuments;
  }

  setTextDocument(uri: DocumentUri, languageId: LanguageId, text: string) {
    this._openTextDocuments.push(createTextDocument(uri, languageId, 0, text));
  }

  updateTextDocument(uri: DocumentUri, newText: string) {
    let idx = this._openTextDocuments.findIndex((t) => t.uri === uri.toString());
    if (idx < 0) {
      throw new Error('Document not found');
    }
    let oldDoc = this._openTextDocuments[idx];
    this._openTextDocuments[idx] = createTextDocument(uri, oldDoc.clientLanguageId, oldDoc.version + 1, newText);
  }

  setNotebookDocument(doc: CopilotTextDocument, notebook: INotebook) {
    this._notebookDocuments.set(doc.uri.replace(/#.*/, ''), notebook);
  }

  findNotebook({ uri }: CopilotTextDocument): INotebook | void {
    return this._notebookDocuments.get(uri.replace(/#.*/, ''));
  }

  getWorkspaceFolders(): WorkspaceFolder[] {
    return this._workspaceFolders;
  }
}

class TestTextDocumentManager extends SimpleTestTextDocumentManager {
  _closedTextDocuments: CopilotTextDocument[] = [];

  constructor(ctx: Context) {
    super(ctx);
  }

  async openTextDocument(uri: DocumentUri) {
    return this._closedTextDocuments.find((t) => t.uri === uri);
  }

  setClosedTextDocument(uri: DocumentUri, languageId: LanguageId, text: string) {
    this._closedTextDocuments.push(createTextDocument(uri, languageId, 0, text));
  }
}

export { TestTextDocumentManager };
