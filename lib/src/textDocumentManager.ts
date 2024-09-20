import { URI } from 'vscode-uri';
import type { DocumentUri, Range } from 'vscode-languageserver-types';
import { Disposable, NotificationHandler } from 'vscode-languageserver/node.js';
import { WorkspaceFolder } from './types.ts';
import { basename, parseUri } from './util/uri.ts';

import { Context } from './context.ts';
import { TextDocument } from './textDocument.ts';

import { isDocumentValid, DocumentValidationResult } from './util/documentEvaluation.ts';

type NotebookCell = {
  index: number; // ? cell.index < activeCell.index
  document: TextDocument;
};

// ./prompt/prompt.ts
// ../../agent/src/textDocumentManager.ts
interface INotebook {
  getCellFor(doc: { uri: DocumentUri }): NotebookCell | undefined;
  getCells(): NotebookCell[];
}

namespace TextDocumentManager {
  // ../agent/src/textDocumentManager.ts
  export type DidFocusTextDocumentParams = { document: { uri: DocumentUri } };

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

  constructor(readonly ctx: Context) {}

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
  async getTextDocument(arg: URI | { uri: DocumentUri }): Promise<TextDocument | undefined> {
    const docId = 'uri' in arg ? arg : { uri: arg.toString() };
    const result = await this.getTextDocumentWithValidation(docId);
    if (result.status === 'valid') return result.document;
  }

  async validateTextDocument(document: TextDocument, uri: DocumentUri): Promise<DocumentValidationResult> {
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

  async getTextDocumentWithValidation(docId: { uri: DocumentUri }): Promise<DocumentValidationResult> {
    const uri = parseUri(docId.uri);
    try {
      let document = this.getOpenTextDocuments().find((t) => t.uri == uri.toString());
      if (!document) {
        document = await this.openTextDocument(uri.toString());
        if (!document) {
          return await this.notFoundResult(docId.uri);
        }
      }
      return isDocumentValid(this.ctx, document);
    } catch {
      return await this.notFoundResult(docId.uri);
    }
  }

  getOpenTextDocumentWithValidation(docId: { uri: DocumentUri }): PromiseLike<DocumentValidationResult> {
    const uri = parseUri(docId.uri);
    const document = this.getOpenTextDocuments().find((t) => t.uri == uri.toString());
    if (document) {
      let memoized;
      return {
        then: (onFulfilled, onRejected) => {
          memoized ??= this.validateTextDocument(document, docId.uri);
          return memoized.then(onFulfilled, onRejected);
        },
      };
    } else {
      return this.notFoundResult(docId.uri);
    }
  }

  async notFoundResult(uri: DocumentUri): Promise<DocumentValidationResult> {
    const knownDocs = (await this.textDocuments()).map((doc) => doc.uri).join(', ');
    return {
      status: 'notfound',
      message: `Document for URI could not be found: ${uri}, URIs of the known document are: ${knownDocs}`,
    };
  }

  async openTextDocument(_: DocumentUri): Promise<TextDocument | undefined> {
    throw new Error('Not found');
  }

  async getWorkspaceFolder(doc: TextDocument): Promise<WorkspaceFolder | undefined> {
    return this.getWorkspaceFolders().find((f) => doc.clientUri.startsWith(f.uri));
  }

  async getRelativePath(doc: TextDocument): Promise<string | undefined> {
    if (!doc.uri.startsWith('untitled:')) {
      for (const folder of this.getWorkspaceFolders()) {
        let parentURI = folder.uri.replace(/[#?].*/, '').replace(/\/?$/, '/');
        if (doc.clientUri.startsWith(parentURI)) return doc.clientUri.slice(parentURI.length);
      }
      return basename(doc.uri);
    }
  }
}

export { TextDocumentManager, INotebook, NotebookCell };
