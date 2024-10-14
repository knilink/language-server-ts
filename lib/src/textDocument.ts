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
    readonly uri: DocumentUri,
    readonly _textDocument: LSPTextDocument,
    readonly detectedLanguageId: LanguageId
  ) {}

  static withChanges(textDocument: TextDocument, changes: TextDocumentContentChangeEvent[], version: number) {
    const lspDoc = LSPTextDocument.create(
      textDocument.clientUri,
      textDocument.clientLanguageId,
      version,
      textDocument.getText()
    );

    LSPTextDocument.update(lspDoc, changes, version);
    return new TextDocument(textDocument.uri, lspDoc, textDocument.detectedLanguageId);
  }

  static create(
    uri: string,
    clientLanguageId: LanguageId,
    version: number,
    text: string,
    detectedLanguageId = detectLanguage({ uri, clientLanguageId })
  ): TextDocument {
    let normalizedUri: DocumentUri;
    try {
      normalizedUri = parseUri(uri, !1).toString();
    } catch {
      normalizedUri = uri;
    }
    return new TextDocument(
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

export { LocationFactory, TextDocument };
