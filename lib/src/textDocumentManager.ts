import path from 'path';
import { URI } from 'vscode-uri';
import { Range } from 'vscode-languageserver-types';
import { Disposable, NotificationHandler } from "vscode-languageserver/node.js";
import { WorkspaceFolder } from './types.ts';

import { Context } from './context.ts';
import { TextDocument } from './textDocument.ts';

import { isDocumentValid, DocumentValidationResult } from './util/documentEvaluation.ts';

type NotebookCell = {
  index: number; // ? cell.index < activeCell.index
  document: TextDocument;
};

// ./prompt/prompt.ts
interface INotebook {
  getCellFor(doc: TextDocument): NotebookCell;
  getCells(): NotebookCell[];
}

namespace TextDocumentManager {
  // ../agent/src/textDocumentManager.ts
  export type DidFocusTextDocumentParams = { document: { uri: URI } };

  // ./changeTracker.ts
  // ../../agent/src/textDocumentManager.ts
  export type DidChangeTextDocumentParams = {
    // TextDocument ../../agent/src/textDocumentManager.ts
    document: TextDocument;
    contentChanges: { range: Range; rangeOffset: number; rangeLength: number; text: string }[];
  };

  export type EventListerner<E, T = any> = (this: T, event: E) => void;

  export type EventListernerRegister<E, T = any> = (
    listener: EventListerner<E, T>,
    thisArgs: T,
    disposables?: boolean
  ) => Disposable;
}

abstract class TextDocumentManager {
  abstract getOpenTextDocuments(): TextDocument[];
  abstract getWorkspaceFolders(): WorkspaceFolder[];
  abstract onDidFocusTextDocument(
    handler: NotificationHandler<TextDocumentManager.DidFocusTextDocumentParams>
  ): Disposable;
  abstract onDidChangeTextDocument(
    handler: NotificationHandler<TextDocumentManager.DidChangeTextDocumentParams>
  ): Disposable;
  // abstract onDidFocusTextDocument<T>(
  //   cb: TextDocumentManager.Listener<T>,
  //   thisArgs: T,
  //   disposables?: boolean
  // ): Disposable;
  abstract findNotebook(doc: TextDocument): INotebook | void;

  constructor(readonly ctx: Context) { }

  async textDocuments(): Promise<TextDocument[]> {
    this.textDocuments.bind;
    const documents = this.getOpenTextDocuments();
    const filteredDocuments: TextDocument[] = [];
    for (const doc of documents) {
      if ((await isDocumentValid(this.ctx, doc)).status === 'valid') {
        filteredDocuments.push(doc);
      }
    }
    return filteredDocuments;
  }

  // uri: URI lib/src/conversation/dump.ts
  async getTextDocument(uri: URI): Promise<TextDocument | undefined> {
    const result = await this.getTextDocumentWithValidation(uri);
    if (result.status === 'valid') {
      return result.document;
    }
  }

  async validateTextDocument(document: TextDocument, uri: URI): Promise<DocumentValidationResult> {
    if (document) {
      try {
        const validationResult = await isDocumentValid(this.ctx, document);
        return validationResult;
      } catch {
        return this.notFoundResult(uri);
      }
    } else {
      return this.notFoundResult(uri);
    }
  }

  async getTextDocumentWithValidation(uri: URI): Promise<DocumentValidationResult> {
    try {
      let document = this.getOpenTextDocuments().find((t) => t.vscodeUri.toString() === uri.toString());
      if (!document) {
        document = await this.openTextDocument(uri);
        if (!document) {
          return await this.notFoundResult(uri);
        }
      }
      return isDocumentValid(this.ctx, document);
    } catch {
      return await this.notFoundResult(uri);
    }
  }

  getOpenTextDocumentWithValidation(uri: URI): Promise<DocumentValidationResult> {
    const document = this.getOpenTextDocuments().find((t) => t.vscodeUri.toString() === uri.toString());
    if (document) {
      return new Promise((resolve, reject) => {
        this.validateTextDocument(document, uri).then(resolve, reject);
      });
    } else {
      return this.notFoundResult(uri);
    }
  }

  async notFoundResult(uri: URI): Promise<DocumentValidationResult> {
    const knownDocs = (await this.textDocuments()).map((doc) => doc.uri).join(', ');
    return {
      status: 'notfound',
      message: `Document for URI could not be found: ${uri}, URIs of the known document are: ${knownDocs}`,
    };
  }

  async openTextDocument(uri: URI): Promise<TextDocument | undefined> {
    throw new Error('Not found');
  }

  async getWorkspaceFolder(doc: TextDocument): Promise<WorkspaceFolder | undefined> {
    const workspaceFolders = this.getWorkspaceFolders();
    return workspaceFolders.find((folder) => doc.vscodeUri.toString().startsWith(folder.toString()));
  }

  async getRelativePath(doc: TextDocument): Promise<string> {
    if (doc.vscodeUri.scheme !== 'untitled') {
      const workspaceFolders = this.getWorkspaceFolders();
      for (const uri of workspaceFolders) {
        const parentURI = uri.with({ query: '', fragment: '' }).toString().replace(/\/?$/, '/');
        if (doc.uri.toString().startsWith(parentURI)) {
          return doc.uri.toString().slice(parentURI.length);
        }
      }
      return path.basename(doc.vscodeUri.fsPath);
    } else {
      throw new Error('Document is untitled');
    }
  }
}

export { TextDocumentManager, INotebook, NotebookCell };
