import type { URI } from 'vscode-uri';
import { detectLanguage } from './language/languageDetection.ts';
import { parseUri } from './util/uri.ts';
import { TextDocument as LSPTextDocument, TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import { Position, Range, DocumentUri } from 'vscode-languageserver-types';

import { LanguageId } from './types.ts';

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
  constructor(
    private _uri: URI,
    private _textDocument: LSPTextDocument,
    readonly detectedLanguageId: LanguageId
  ) {}

  static withChanges(textDocument: TextDocument, changes: TextDocumentContentChangeEvent[], version: number) {
    let lspDoc = TextDocument.create(
      textDocument.clientUri,
      textDocument.clientLanguageId,
      version,
      textDocument.getText()
    );

    LSPTextDocument.update(lspDoc, changes, version);
    return new TextDocument(textDocument.vscodeUri, lspDoc, textDocument.detectedLanguageId);
  }

  static create(
    uri: URI | string,
    clientLanguageId: LanguageId,
    version: number,
    text: string,
    detectedLanguageId = detectLanguage({ uri: uri.toString() }) ?? clientLanguageId
  ): TextDocument {
    return typeof uri == 'string'
      ? new TextDocument(
          parseUri(uri),
          LSPTextDocument.create(uri, clientLanguageId, version, text),
          detectedLanguageId
        )
      : new TextDocument(
          uri,
          LSPTextDocument.create(uri.toString(), clientLanguageId, version, text),
          detectedLanguageId
        );
  }

  get uri(): DocumentUri {
    return this._uri.toString();
  }

  get clientUri(): DocumentUri {
    return this._textDocument.uri;
  }

  get vscodeUri(): URI {
    return this._uri;
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

export { LocationFactory, TextDocument };
