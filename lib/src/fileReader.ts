import { Context } from './context.ts';
import { TextDocumentManager } from './textDocumentManager.ts';
import { CopilotContentExclusionManager } from './contentExclusion/contentExclusionManager.ts';
import { CopilotTextDocument } from './textDocument.ts';
import { FileSystem } from './fileSystem.ts';
import { DocumentValidationResult } from './util/documentEvaluation.ts';
import { basename } from './util/uri.ts';
import { DocumentUri } from 'vscode-languageserver-types';

type TextDocumentResultStatus = 'empty' | 'included' | 'blocked' | 'notfound';

function statusFromTextDocumentResult(textDocumentResult: DocumentValidationResult): TextDocumentResultStatus {
  switch (textDocumentResult.status) {
    case 'valid':
      return textDocumentResult.document.getText().trim().length === 0 ? 'empty' : 'included';
    case 'invalid':
      return 'blocked';
    case 'notfound':
      return 'notfound';
  }
}

class FileReader {
  constructor(readonly ctx: Context) {}

  async getRelativePath(doc: CopilotTextDocument): Promise<string> {
    return this.ctx.get(TextDocumentManager).getRelativePath(doc) ?? basename(doc.uri);
  }

  async readFile(uri: string): Promise<DocumentValidationResult> {
    const documentResult = await this.readFromTextDocumentManager({ uri });
    return documentResult.status !== 'notfound' ? documentResult : await this.readFromFilesystem(uri);
  }

  async readFromTextDocumentManager(doc: { uri: DocumentUri }): Promise<DocumentValidationResult> {
    return await this.ctx.get(TextDocumentManager).getTextDocumentWithValidation(doc);
  }

  async readFromFilesystem(uri: DocumentUri): Promise<DocumentValidationResult> {
    if (await this.fileExists(uri)) {
      const fileSizeMB = await this.getFileSizeMB(uri);
      if (fileSizeMB > 1) return { status: 'notfound', message: 'File too large' };

      const text = await this.doReadFile(uri);
      return (await this.ctx.get(CopilotContentExclusionManager).evaluate(uri, text)).isBlocked
        ? { status: 'invalid', reason: 'blocked' }
        : { status: 'valid', document: CopilotTextDocument.create(uri, 'UNKNOWN', 0, text) };
    }
    return { status: 'notfound', message: 'File not found' };
  }

  async doReadFile(uri: DocumentUri): Promise<string> {
    const fileSystem = this.ctx.get(FileSystem);
    return await fileSystem.readFileString(uri);
  }

  async getFileSizeMB(uri: DocumentUri): Promise<number> {
    const fileSystem = this.ctx.get(FileSystem);
    const stats = await fileSystem.stat(uri);
    return stats.size / 1024 / 1024;
  }

  async fileExists(file: DocumentUri): Promise<boolean> {
    try {
      const fileSystem = this.ctx.get(FileSystem);
      await fileSystem.stat(file);
      return true;
    } catch {
      return false;
    }
  }
}

export { FileReader, statusFromTextDocumentResult, TextDocumentResultStatus, DocumentValidationResult };
