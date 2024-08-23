import { URI } from 'vscode-uri';
import { TextDocument as LSPTextDocument, TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import { Position, Range, DocumentUri } from 'vscode-languageserver-types';

import { LanguageId } from './types';

class LocationFactory {
  static range(x1: number, y1: number, x2: number, y2: number): Range;
  static range(x: Position, y: Position): Range;
  static range(x1: number | Position, y1: number | Position, x2?: number, y2?: number): Range {
    return x2 !== undefined && y2 !== undefined
      ? Range.create(Position.create(x1 as number, y1 as number), Position.create(x2, y2))
      : Range.create(x1 as Position, y1 as Position);
  }

  static position(line: number, character: number): Position {
    return Position.create(line, character);
  }
}

class TextDocument {
  private _uri: URI;
  private _textDocument: LSPTextDocument;

  constructor(uri: URI | string, textDocument: LSPTextDocument) {
    this._uri = typeof uri === 'string' ? URI.parse(uri) : uri;
    this._textDocument = textDocument;
  }

  static create(uri: URI | string, languageId: LanguageId, version: number, text: string): TextDocument {
    const lspTextDoc = LSPTextDocument.create(uri.toString(), languageId, version, text);
    return new TextDocument(typeof uri === 'string' ? URI.parse(uri) : uri, lspTextDoc);
  }

  static wrap(textDocument: LSPTextDocument): TextDocument {
    const uri = URI.parse(textDocument.uri);
    return new TextDocument(uri, textDocument);
  }

  get lspTextDocument(): LSPTextDocument {
    return this._textDocument;
  }

  get uri(): DocumentUri {
    return this._uri.toString();
  }

  get vscodeUri(): URI {
    return this._uri;
  }

  get languageId(): LanguageId {
    return this._textDocument.languageId;
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

  update(changes: TextDocumentContentChangeEvent[], version: number): void {
    LSPTextDocument.update(this._textDocument, changes, version);
  }
}

export { LocationFactory, TextDocument };
