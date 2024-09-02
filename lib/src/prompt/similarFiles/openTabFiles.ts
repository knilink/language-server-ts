import { URI } from 'vscode-uri';

import { TextDocument } from '../../textDocument.ts';

import { Document, LanguageId } from '../../../../prompt/src/lib.ts';
import { TextDocumentManager } from '../../textDocumentManager.ts';

import { NeighborSource, considerNeighborFile } from './neighborFiles.ts';
import { sortByAccessTimes } from '../../documentTracker.ts';

class OpenTabFiles {
  private docManager: TextDocumentManager;

  constructor(docManager: TextDocumentManager) {
    this.docManager = docManager;
  }

  async truncateDocs(
    docs: TextDocument[],
    fileURI: URI,
    languageId: string,
    maxNumNeighborFiles: number
  ): Promise<Map<string, Document>> {
    const openFiles: Map<string, Document> = new Map();
    let totalLen = 0;

    for (const doc of docs) {
      if (
        !(totalLen + doc.getText().length > NeighborSource.MAX_NEIGHBOR_AGGREGATE_LENGTH) &&
        // doc.uri.scheme === 'file' && // MARK fuck this, doc.uri -> string
        // fileURI.scheme === 'file' &&
        // doc.uri.fsPath !== fileURI.fsPath &&
        doc.vscodeUri.scheme === 'file' &&
        fileURI.scheme === 'file' &&
        doc.vscodeUri.fsPath !== fileURI.fsPath &&
        considerNeighborFile(languageId, doc.languageId)
      ) {
        openFiles.set(doc.uri.toString(), {
          uri: doc.uri.toString(),
          relativePath: await this.docManager.getRelativePath(doc),
          languageId: doc.languageId,
          source: doc.getText(),
        });
        totalLen += doc.getText().length;
      }
      if (openFiles.size >= maxNumNeighborFiles) break;
    }
    return openFiles;
  }

  async getNeighborFiles(
    uri: URI,
    languageId: LanguageId,
    maxNumNeighborFiles: number
  ): Promise<{ docs: Map<string, Document>; neighborSource: Map<string, string[]> }> {
    const neighborFiles = new Map<string, any>();
    const neighborSource = new Map<string, string[]>();

    const sortedDocs = await this.truncateDocs(
      sortByAccessTimes(await this.docManager.textDocuments()),
      uri,
      languageId,
      maxNumNeighborFiles
    );
    neighborFiles.set(
      'opentabs',
      Array.from(sortedDocs.keys()).map((uri) => uri.toString())
    );

    return { docs: sortedDocs, neighborSource };
  }
}

export { OpenTabFiles };
