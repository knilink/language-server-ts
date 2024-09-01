import { URI } from 'vscode-uri';
import { describe, beforeEach, expect, it } from 'vitest';
import { Position, Range } from 'vscode-languageserver-types';
import { TextDocument } from "./textDocument.ts";

describe('TextDocument', () => {
  const uri = URI.parse('file:///test.txt');
  const languageId = 'plaintext';
  const version = 1;
  const text = 'Hello, World!';

  let document: TextDocument;

  beforeEach(() => {
    document = TextDocument.create(uri, languageId, version, text);
  });

  it('should create a TextDocument instance', () => {
    expect(document).toBeInstanceOf(TextDocument);
  });

  it('should get the correct URI', () => {
    expect(document.uri).toEqual(uri.toString());
  });

  it('should get the language ID', () => {
    expect(document.languageId).toEqual(languageId);
  });

  it('should get the version number', () => {
    expect(document.version).toEqual(version);
  });

  it('should get the correct line count', () => {
    expect(document.lineCount).toEqual(1); // Since there is only one line of text
  });

  it('should retrieve text from a specific range', () => {
    const range = Range.create(Position.create(0, 7), Position.create(0, 12));
    expect(document.getText(range)).toEqual('World');
  });

  it('should get the correct position at an offset', () => {
    const offset = text.indexOf('W');
    expect(document.positionAt(offset)).toEqual({ line: 0, character: 7 });
  });

  it('should get the correct offset at a specific position', () => {
    const position = Position.create(0, 7);
    expect(document.offsetAt(position)).toEqual(text.indexOf('W'));
  });

  it('should retrieve line details correctly', () => {
    const result = document.lineAt(0);
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('range');
    expect(result).toHaveProperty('isEmptyOrWhitespace');
  });

  it('should update the text document with changes', () => {
    const newText = 'Hello, Goodbye!';
    const change = {
      range: Range.create(Position.create(0, 7), Position.create(0, 12)),
      rangeLength: 5,
      text: 'Goodbye',
    };
    document.update([change], version + 1);
    expect(document.getText(Range.create(Position.create(0, 0), Position.create(0, newText.length)))).toEqual(newText);
  });
});
