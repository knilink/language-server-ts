import { TextDocument as LSPTextDocument, TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import { Position, Range, DocumentUri } from 'vscode-languageserver-types';

import { LanguageId } from './types.ts';
import { detectLanguage } from './language/languageDetection.ts';
import { normalizeUri } from './util/uri.ts';

class LocationFactory {
  static range = Range.create.bind(Range);
  static position = Position.create.bind(Position);
}

class CopilotTextDocument {
  constructor(
    readonly uri: DocumentUri,
    readonly _textDocument: LSPTextDocument,
    readonly detectedLanguageId: LanguageId
  ) {}

  static withChanges(textDocument: CopilotTextDocument, changes: TextDocumentContentChangeEvent[], version: number) {
    const lspDoc = LSPTextDocument.create(
      textDocument.clientUri,
      textDocument.clientLanguageId,
      version,
      textDocument.getText()
    );

    LSPTextDocument.update(lspDoc, changes, version);
    return new CopilotTextDocument(textDocument.uri, lspDoc, textDocument.detectedLanguageId);
  }

  static create(
    uri: string,
    clientLanguageId: LanguageId,
    version: number,
    text: string,
    detectedLanguageId = detectLanguage({ uri, clientLanguageId })
  ): CopilotTextDocument {
    const normalizedUri = normalizeUri(uri);
    return new CopilotTextDocument(
      normalizedUri,
      LSPTextDocument.create(uri, clientLanguageId, version, text),
      detectedLanguageId
    );
  }

  get clientUri(): DocumentUri {
    return this._textDocument.uri;
  }

  get clientLanguageId(): LanguageId {
    return this._textDocument.languageId;
  }

  get languageId() {
    return this.detectedLanguageId;
  }

  get version(): number {
    return this._textDocument.version;
  }

  get lineCount(): number {
    return this._textDocument.lineCount;
  }

  getText(range?: Range): string {
    return this._textDocument.getText(range);
  }

  positionAt(offset: number): Position {
    return this._textDocument.positionAt(offset);
  }

  offsetAt(position: Position): number {
    return this._textDocument.offsetAt(position);
  }

  lineAt(positionOrLineNumber: number | Position): { text: string; range: Range; isEmptyOrWhitespace: boolean } {
    const lineNumber = typeof positionOrLineNumber === 'number' ? positionOrLineNumber : positionOrLineNumber.line;
    if (lineNumber < 0 || lineNumber >= this.lineCount) throw new RangeError('Illegal value for lineNumber');

    const text = this._textDocument.getText().split(/\r\n|\r|\n/g)[lineNumber];
    const range = Range.create(Position.create(lineNumber, 0), Position.create(lineNumber, text.length));
    const isEmptyOrWhitespace = text.trim().length === 0;

    return { text, range, isEmptyOrWhitespace };
  }
}

export { LocationFactory, CopilotTextDocument };
