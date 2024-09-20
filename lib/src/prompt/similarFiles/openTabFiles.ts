import { DocumentUri } from 'vscode-languageserver-types';

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
    uri: DocumentUri,
    languageId: LanguageId,
    maxNumNeighborFiles: number
  ): Promise<Map<string, Document>> {
    const openFiles: Map<string, Document> = new Map();
    let totalLen = 0;

    for (const doc of docs) {
      if (
        !(totalLen + doc.getText().length > NeighborSource.MAX_NEIGHBOR_AGGREGATE_LENGTH) &&
        doc.uri.startsWith('file:') &&
        uri.startsWith('file:') &&
        doc.uri !== uri &&
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
    uri: DocumentUri,
    languageId: LanguageId,
    maxNumNeighborFiles: number
  ): Promise<{ docs: Map<string, Document>; neighborSource: Map<string, DocumentUri[]> }> {
    // const neighborFiles = new Map<string, Documen[]>();
    const neighborSource = new Map<string, string[]>();

    const neighborFiles = await this.truncateDocs(
      sortByAccessTimes(await this.docManager.textDocuments()),
      uri,
      languageId,
      maxNumNeighborFiles
    );

    neighborSource.set(
      'opentabs',
      Array.from(neighborFiles.keys()).map((uri) => uri.toString())
    );

    return { docs: neighborFiles, neighborSource };
  }
}

export { OpenTabFiles };
