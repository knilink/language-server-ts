import path from 'node:path';
import { URI } from 'vscode-uri';
import { Context } from "./context.ts";
import { TextDocumentManager } from "./textDocumentManager.ts";
import { CopilotContentExclusionManager } from "./contentExclusion/contentExclusionManager.ts";
import { TextDocument } from "./textDocument.ts";
import { LanguageDetection } from "./language/languageDetection.ts";
import { FileSystem } from "./fileSystem.ts";
import { DocumentValidationResult } from "./util/documentEvaluation.ts";

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
  constructor(readonly ctx: Context) { }

  async getRelativePath(doc: TextDocument): Promise<string> {
    const textDocumentManager = this.ctx.get<TextDocumentManager>(TextDocumentManager);
    return (await textDocumentManager.getRelativePath(doc)) ?? path.basename((doc as any).vscodeUri.fsPath);
  }

  async readFile(uri: string): Promise<DocumentValidationResult> {
    const fileUri = URI.parse(uri);
    const documentResult = await this.readFromTextDocumentManager(fileUri);
    return documentResult.status !== 'notfound' ? documentResult : await this.readFromFilesystem(fileUri);
  }

  async readFromTextDocumentManager(uri: URI): Promise<DocumentValidationResult> {
    const textDocumentManager = this.ctx.get<TextDocumentManager>(TextDocumentManager);
    return await textDocumentManager.getTextDocumentWithValidation(uri);
  }

  async readFromFilesystem(uri: URI): Promise<DocumentValidationResult> {
    if (await this.fileExists(uri)) {
      const fileSizeMB = await this.getFileSizeMB(uri);
      if (fileSizeMB > 1) return { status: 'notfound', message: 'File too large' };

      const text = await this.doReadFile(uri);
      const copilotContentExclusionManager =
        this.ctx.get<CopilotContentExclusionManager>(CopilotContentExclusionManager);
      if (!(await copilotContentExclusionManager.evaluate(uri, text)).isBlocked) {
        const tmpDoc = TextDocument.create(uri, 'UNKNOWN', 0, text);
        const languageDetection = this.ctx.get<LanguageDetection>(LanguageDetection);
        const languageId = languageDetection.detectLanguage(tmpDoc).languageId;

        return { status: 'valid', document: TextDocument.create(uri, languageId, 0, text) };
      }
      return { status: 'invalid', reason: 'blocked' };
    }
    return { status: 'notfound', message: 'File not found' };
  }

  async doReadFile(uri: URI): Promise<string> {
    const fileSystem = this.ctx.get<FileSystem>(FileSystem);
    return await fileSystem.readFileString(uri);
  }

  async getFileSizeMB(uri: URI): Promise<number> {
    const fileSystem = this.ctx.get<FileSystem>(FileSystem);
    const stats = await fileSystem.stat(uri);
    return stats.size / 1024 / 1024;
  }

  async fileExists(file: URI): Promise<boolean> {
    try {
      const fileSystem = this.ctx.get<FileSystem>(FileSystem);
      await fileSystem.stat(file);
      return true;
    } catch {
      return false;
    }
  }
}

export { FileReader, statusFromTextDocumentResult, TextDocumentResultStatus };
