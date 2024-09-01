import { describe, it, expect, beforeEach } from 'vitest';
import { ITokenizer, getTokenizer } from "./tokenizer.ts";

describe('TTokenizer', () => {
  let tokenizer: ITokenizer;

  beforeEach(() => {
    tokenizer = getTokenizer('cl100k_base');
  });

  it('should correctly tokenize and detokenize text', () => {
    const text = 'Hello world';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toHaveLength(2);
    const detokenizedText = tokenizer.detokenize(tokens);
    expect(detokenizedText).toBe(text);
  });

  it('should return the correct token length', () => {
    const text = 'Hello world';
    const length = tokenizer.tokenLength(text);
    expect(length).toBeGreaterThan(0);
  });

  it('should take the last tokens from a string', () => {
    const text = 'Hello world';
    const result = tokenizer.takeLastTokens(text, 1);
    expect(result).toBe('world');
  });

  it('should take the first tokens from a string', () => {
    const text = 'Hello world';
    const result = tokenizer.takeFirstTokens(text, 1);
    expect(result.text).toBe('Hello');
  });
});

describe('MockTokenizer', () => {
  let mockTokenizer: ITokenizer;

  beforeEach(() => {
    mockTokenizer = getTokenizer('mock');
  });

  it('should correctly tokenize and detokenize text', () => {
    const text = 'Hello world';
    const tokens = mockTokenizer.tokenize(text);
    expect(tokens).toHaveLength(3);
    const detokenizedText = mockTokenizer.detokenize(tokens);
    expect(detokenizedText).toBe('10418 32 7058');
  });

  it('should return the correct token length', () => {
    const text = 'Hello world';
    const length = mockTokenizer.tokenLength(text);
    expect(length).toBeGreaterThan(0);
  });

  it('should take the last tokens from a string', () => {
    const text = 'Hello world';
    const result = mockTokenizer.takeLastTokens(text, 1);
    expect(result).toBe('world');
  });

  it('should take the first tokens from a string', () => {
    const text = 'Hello world';
    const result = mockTokenizer.takeFirstTokens(text, 1);
    expect(result.text).toBe('Hello');
  });
});
