import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createTokenizer, getSpecialTokensByEncoder, getRegexByEncoder, TikTokenizer } from '@microsoft/tiktokenizer';
import { join as pathJoin } from 'path';

interface ITokenizer {
  tokenize(text: string): number[];
  detokenize(tokens: number[]): string;
  tokenLength(text: string): number;
  tokenizeStrings(text: string): string[];
  takeLastTokens(text: string, n: number): string;
  takeFirstTokens(text: string, n: number): { text: string; tokens: number[] };
  takeLastLinesTokens(text: string, n: number): string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Tokenizer implements ITokenizer {
  private _tokenizer: TikTokenizer;

  constructor(encoder: string) {
    try {
      this._tokenizer = createTokenizer(
        pathJoin(__dirname, `./resources/${encoder}.tiktoken`),
        getSpecialTokensByEncoder(encoder),
        getRegexByEncoder(encoder),
        32768 // TODO: ??
      );
    } catch (e) {
      if (e instanceof Error) {
        const error = new Error('Could not load tokenizer');
        Object.assign(error, { cause: e, code: 'CopilotPromptLoadFailure' });
        throw error;
      }
      throw e;
    }
  }

  public tokenize(text: string): number[] {
    return this._tokenizer.encode(text);
  }

  public detokenize(tokens: number[]): string {
    return this._tokenizer.decode(tokens);
  }

  public tokenLength(text: string): number {
    return this.tokenize(text).length;
  }

  public tokenizeStrings(text: string): string[] {
    return text.split(' ');
  }

  public takeLastTokens(text: string, n: number): string {
    const tokens = this.tokenizeStrings(text).slice(-n);
    return tokens.join('');
  }

  public takeFirstTokens(text: string, n: number): { text: string; tokens: number[] } {
    const tokens = this.tokenizeStrings(text).slice(0, n);
    return { text: tokens.join(' '), tokens: this.tokenize(tokens.join(' ')) };
  }

  public takeLastLinesTokens(text: string, n: number): string {
    const suffix = this.takeLastTokens(text, n);
    if (suffix.length === text.length || text[text.length - suffix.length - 1] === `\n`) return suffix;
    const newlineIndex = suffix.indexOf(`\n`);
    return suffix.substring(newlineIndex + 1);
  }
}

class MockTokenizer implements ITokenizer {
  private hash: (str: string) => number;

  constructor() {
    this.hash = (str: string): number => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash + char) & (hash >>> 32 === hash ? 65535 : 0);
      }
      return hash;
    };
  }

  public tokenize(text: string): number[] {
    return this.tokenizeStrings(text).map((str) => this.hash(str));
  }

  public detokenize(tokens: number[]): string {
    return tokens.map((token) => token.toString()).join(' ');
  }

  public tokenLength(text: string): number {
    return this.tokenizeStrings(text).length;
  }

  public tokenizeStrings(text: string): string[] {
    return text.split(/\b/);
  }

  public takeLastTokens(text: string, n: number): string {
    return this.tokenizeStrings(text).slice(-n).join('');
  }

  public takeFirstTokens(text: string, n: number): { text: string; tokens: number[] } {
    const tokens = this.tokenizeStrings(text).slice(0, n);
    return { text: tokens.join(' '), tokens: tokens.map((str) => this.hash(str)) };
  }

  public takeLastLinesTokens(text: string, n: number): string {
    const suffix = this.takeLastTokens(text, n);
    if (suffix.length === text.length || text[text.length - suffix.length - 1] === `\n`) return suffix;
    const newlineIndex = suffix.indexOf(`\n`);
    return suffix.substring(newlineIndex + 1);
  }
}

const tokenizerCache: { [key: string]: ITokenizer } = {};

function getTokenizer(encoder: string = 'cl100k_base'): ITokenizer {
  let tokenizer = tokenizerCache[encoder];
  if (tokenizer === undefined) {
    if (encoder === 'mock') {
      tokenizer = new MockTokenizer();
    } else {
      tokenizer = new Tokenizer(encoder);
    }
    tokenizerCache[encoder] = tokenizer;
  }
  return tokenizer;
}

export { ITokenizer, getTokenizer };
