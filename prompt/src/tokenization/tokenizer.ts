import * as fs from 'node:fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createTokenizer, getSpecialTokensByEncoder, getRegexByEncoder, TikTokenizer } from '@microsoft/tiktokenizer';
import { CopilotPromptLoadFailure } from '../error.ts';

interface ITokenizer {
  tokenize(text: string): number[];
  detokenize(tokens: number[]): string;
  tokenLength(text: string): number;
  tokenizeStrings(text: string): string[];
  takeLastTokens(text: string, n: number): { text: string; tokens: number[] };
  takeFirstTokens(text: string, n: number): { text: string; tokens: number[] };
  takeLastLinesTokens(text: string, n: number): string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getTokenizer(encoder: string = 'cl100k_base'): ITokenizer {
  let tokenizer = tokenizers.get(encoder);
  if (tokenizer === undefined) {
    if (encoder === 'mock') {
      tokenizer = new MockTokenizer();
    } else {
      tokenizer = new TTokenizer(encoder);
    }
    tokenizers.set(encoder, tokenizer);
  }
  return tokenizer;
}

function parseTikTokenNoIndex(file: string) {
  if (!file.endsWith('.tiktoken.noindex')) {
    throw new Error('File does not end with .tiktoken.noindex');
  }
  const contents = fs.readFileSync(file, 'utf-8');
  const result = new Map();
  for (const line of contents.split('\n')) {
    if (!line) continue;
    let buffer = Buffer.from(line, 'base64');
    result.set(buffer, result.size);
  }
  return result;
}

const tokenizers = new Map<string, ITokenizer>();

class TTokenizer implements ITokenizer {
  _tokenizer: TikTokenizer;

  constructor(encoder: string) {
    try {
      this._tokenizer = createTokenizer(
        parseTikTokenNoIndex(path.join(__dirname, `./resources/${encoder}.tiktoken.noindex`)),
        getSpecialTokensByEncoder(encoder),
        getRegexByEncoder(encoder),
        32768 // TODO: ??
      );
    } catch (e) {
      if (e instanceof Error) {
        throw new CopilotPromptLoadFailure('Could not load tokenizer', e);
      }
      throw e;
    }
  }

  tokenize(text: string): number[] {
    return this._tokenizer.encode(text);
  }

  detokenize(tokens: number[]): string {
    return this._tokenizer.decode(tokens);
  }

  tokenLength(text: string): number {
    return this.tokenize(text).length;
  }

  tokenizeStrings(text: string): string[] {
    return this.tokenize(text).map((token) => this.detokenize([token]));
  }

  takeLastTokens(text: string, n: number): { text: string; tokens: number[] } {
    if (n <= 0) {
      return { text: '', tokens: [] };
    }
    let CHARS_PER_TOKENS_START = 4;
    let CHARS_PER_TOKENS_ADD = 1;
    let chars = Math.min(text.length, n * CHARS_PER_TOKENS_START);
    let suffix = text.slice(-chars);
    let suffixT = this.tokenize(suffix);
    for (; suffixT.length < n + 2 && chars < text.length; ) {
      chars = Math.min(text.length, chars + n * CHARS_PER_TOKENS_ADD);
      suffix = text.slice(-chars);
      suffixT = this.tokenize(suffix);
    }
    if (suffixT.length < n) {
      return { text, tokens: suffixT };
    }
    suffixT = suffixT.slice(-n);
    return { text: this.detokenize(suffixT), tokens: suffixT };
  }

  takeFirstTokens(text: string, n: number): { text: string; tokens: number[] } {
    if (n <= 0) {
      return { text: '', tokens: [] };
    }
    let CHARS_PER_TOKENS_START = 4;
    let CHARS_PER_TOKENS_ADD = 1;
    let chars = Math.min(text.length, n * CHARS_PER_TOKENS_START);
    let prefix = text.slice(0, chars);
    let prefix_t = this.tokenize(prefix);
    for (; prefix_t.length < n + 2 && chars < text.length; ) {
      chars = Math.min(text.length, chars + n * CHARS_PER_TOKENS_ADD);
      prefix = text.slice(0, chars);
      prefix_t = this.tokenize(prefix);
    }
    if (prefix_t.length < n) {
      return { text, tokens: prefix_t };
    }
    prefix_t = prefix_t.slice(0, n);
    return { text: this.detokenize(prefix_t), tokens: prefix_t };
  }

  takeLastLinesTokens(text: string, n: number): string {
    const { text: suffix } = this.takeLastTokens(text, n);
    if (suffix.length === text.length || text[text.length - suffix.length - 1] === '\n') {
      return suffix;
    }
    const newline = suffix.indexOf('\n');
    return suffix.substring(newline + 1);
  }
}

class MockTokenizer implements ITokenizer {
  private hash: (str: string) => number;

  constructor() {
    this.hash = (str: string): number => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash &= hash & 65535;
      }
      return hash;
    };
  }

  tokenize(text: string): number[] {
    return this.tokenizeStrings(text).map((str) => this.hash(str));
  }

  detokenize(tokens: number[]): string {
    return tokens.map((token) => token.toString()).join(' ');
  }

  tokenLength(text: string): number {
    return this.tokenizeStrings(text).length;
  }

  tokenizeStrings(text: string): string[] {
    return text.split(/\b/);
  }

  takeLastTokens(text: string, n: number): { text: string; tokens: number[] } {
    const tokens = this.tokenizeStrings(text).slice(-n);
    return { text: tokens.join(''), tokens: tokens.map(this.hash) };
  }

  takeFirstTokens(text: string, n: number): { text: string; tokens: number[] } {
    const tokens = this.tokenizeStrings(text).slice(0, n);
    return { text: tokens.join(' '), tokens: tokens.map((str) => this.hash(str)) };
  }

  takeLastLinesTokens(text: string, n: number): string {
    const { text: suffix } = this.takeLastTokens(text, n);
    if (suffix.length === text.length || text[text.length - suffix.length - 1] === '\n') {
      return suffix;
    }
    const newline = suffix.indexOf('\n');
    return suffix.substring(newline + 1);
  }
}

export { ITokenizer, getTokenizer };
