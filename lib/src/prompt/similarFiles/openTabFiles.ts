import type { DocumentUri } from 'vscode-languageserver-types';
import type { CopilotTextDocument } from '../../textDocument.ts';
import type { LanguageId, OpenDocument } from '../../../../prompt/src/lib.ts';
import type { TextDocumentManager } from '../../textDocumentManager.ts';

import { NeighborSource, considerNeighborFile } from './neighborFiles.ts';
import { sortByAccessTimes } from '../../documentTracker.ts';

class OpenTabFiles {
  private docManager: TextDocumentManager;

  constructor(docManager: TextDocumentManager) {
    this.docManager = docManager;
  }

  async truncateDocs(
    docs: CopilotTextDocument[],
    uri: DocumentUri,
    languageId: LanguageId,
    maxNumNeighborFiles: number
  ): Promise<Map<string, OpenDocument>> {
    const openFiles = new Map<string, OpenDocument>();
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
          relativePath: this.docManager.getRelativePath(doc),
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
  ): Promise<{
    docs: Map<string, OpenDocument>;
    neighborSource: Map<string, DocumentUri[]>;
  }> {
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
