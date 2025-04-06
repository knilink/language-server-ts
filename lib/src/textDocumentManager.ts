import type { URI } from 'vscode-uri';
import type { DocumentUri, Range, WorkspaceFolder } from 'vscode-languageserver-types';
import type { Disposable, NotificationHandler } from 'vscode-languageserver/node.js';
import type { Context } from './context.ts';

import { FileSystem } from './fileSystem.ts';
import { CopilotTextDocument } from './textDocument.ts';
import { isDocumentValid, type DocumentValidationResult } from './util/documentEvaluation.ts';
import { basename, normalizeUri } from './util/uri.ts';

type NotebookCell = {
  index: number; // ? cell.index < activeCell.index
  document: CopilotTextDocument;
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
    document: CopilotTextDocument;
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
  abstract getOpenTextDocuments(): CopilotTextDocument[];
  abstract getWorkspaceFolders(): WorkspaceFolder[];
  abstract onDidFocusTextDocument(
    handler: NotificationHandler<TextDocumentManager.DidFocusTextDocumentParams | undefined>
  ): Disposable;
  abstract onDidChangeTextDocument(
    handler: NotificationHandler<TextDocumentManager.DidChangeTextDocumentParams>
  ): Disposable;
  // abstract onDidFocusTextDocument<T>(
  //   cb: TextDocumentManager.Listener<T>,
  //   thisArgs: T,
  //   disposables?: boolean
  // ): Disposable;
  abstract findNotebook(doc: CopilotTextDocument): INotebook | void;

  constructor(readonly ctx: Context) {}

  async textDocuments(): Promise<CopilotTextDocument[]> {
    this.textDocuments.bind;
    const documents = this.getOpenTextDocuments();
    const filteredDocuments: CopilotTextDocument[] = [];
    for (const doc of documents) {
      if ((await isDocumentValid(this.ctx, doc)).status === 'valid') {
        filteredDocuments.push(doc);
      }
    }
    return filteredDocuments;
  }

  getOpenTextDocument(docId: { uri: DocumentUri }) {
    const uri = normalizeUri(docId.uri);
    return this.getOpenTextDocuments().find((t) => t.uri == uri);
  }

  // uri: URI lib/src/conversation/dump.ts
  async getTextDocument(arg: URI | { uri: DocumentUri }): Promise<CopilotTextDocument | undefined> {
    const docId = 'uri' in arg ? arg : { uri: arg.toString() };
    const result = await this.getTextDocumentWithValidation(docId);
    if (result.status === 'valid') return result.document;
  }

  async validateTextDocument(document: CopilotTextDocument, uri: DocumentUri): Promise<DocumentValidationResult> {
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
    try {
      let document = this.getOpenTextDocument(docId);
      return !document && ((document = await this.openTextDocument(docId.uri)), !document)
        ? await this.notFoundResult(docId.uri)
        : isDocumentValid(this.ctx, document);
    } catch {
      return await this.notFoundResult(docId.uri);
    }
  }

  getOpenTextDocumentWithValidation(docId: { uri: DocumentUri }): PromiseLike<DocumentValidationResult> {
    const document = this.getOpenTextDocument(docId);
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

  async openTextDocument(uri: DocumentUri): Promise<CopilotTextDocument | undefined> {
    try {
      if ((await this.ctx.get(FileSystem).stat(uri)).size > 5 * 1024 * 1024) {
        return;
      }
    } catch {
      return;
    }
    const text = await this.ctx.get(FileSystem).readFileString(uri);
    return CopilotTextDocument.create(uri, 'UNKNOWN', 0, text);
  }

  async getWorkspaceFolder(doc: CopilotTextDocument): Promise<WorkspaceFolder | undefined> {
    return this.getWorkspaceFolders().find((f) => doc.clientUri.startsWith(f.uri));
  }

  getRelativePath(doc: CopilotTextDocument): string | undefined {
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
