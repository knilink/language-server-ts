import type { DocumentUri } from 'vscode-languageserver-types';
import type { Context } from '../../context.ts';
import type { DocumentValidationResult } from '../../fileReader.ts';

import { FileReader } from '../../fileReader.ts';

interface TextDocumentProvider {
  getByUri(uri: DocumentUri): Promise<DocumentValidationResult>;
}

class DefaultTextDocumentProvider implements TextDocumentProvider {
  constructor(readonly ctx: Context) {}

  async getByUri(uri: DocumentUri): Promise<DocumentValidationResult> {
    return await this.ctx.get(FileReader).readFile(uri);
  }
}

export { DefaultTextDocumentProvider, TextDocumentProvider };
