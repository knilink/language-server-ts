import { describe, it, expect } from 'vitest';
import { getCursorContext } from "./cursorContext.ts";

// Mock the tokenizer functions as needed for testing purposes.
const mockTokenizer = {
  takeLastLinesTokens: (context: string, maxTokenLength: number) => context, // Simplified for test purposes
  tokenLength: (context: string) => context.length, // Simplified for test purposes
};

const source = new Array(9)
  .fill(null)
  .map((_, i) => `${i}`)
  .join('\n');

describe('getCursorContext', () => {
  it('should return context with default options', () => {
    const doc = { source, offset: 15, uri: '', languageId: '' };
    const result = getCursorContext(doc, { tokenizerName: 'mock' });
    console.log(result);
    expect(result).toEqual({
      context: '0\n1\n2\n3\n4\n5\n6\n7',
      lineCount: 8,
      tokenLength: 15,
      tokenizerName: 'mock',
    });
  });

  it('should handle maxLineCount option correctly', () => {
    const doc = { source, offset: 5 * 2 + 1, uri: '', languageId: '' };
    const result = getCursorContext(doc, { tokenizerName: 'mock', maxLineCount: 3 });
    console.log(result);
    expect(result).toEqual({
      context: '3\n4\n5',
      lineCount: 3,
      tokenLength: 5,
      tokenizerName: 'mock',
    });
  });

  it('should handle maxTokenLength option correctly', () => {
    const doc = { source, offset: 8 * 2, uri: '', languageId: '' };
    const result = getCursorContext(doc, { tokenizerName: 'mock', maxTokenLength: 6 * 2 });
    console.log(result);
    expect(result).toEqual({
      context: '2\n3\n4\n5\n6\n7\n',
      lineCount: 7,
      tokenLength: 12,
      tokenizerName: 'mock',
    });
  });
});
