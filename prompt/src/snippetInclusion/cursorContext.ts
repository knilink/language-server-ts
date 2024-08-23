import { Document } from '../types';
import { getTokenizer } from '../tokenization';

export function getCursorContext(
  doc: Document,
  options: {
    tokenizerName?: string;
    maxLineCount?: number;
    maxTokenLength?: number;
  }
): CursorContext {
  const { tokenizerName = 'cl100k_base', maxLineCount, maxTokenLength } = options;
  const tokenizer = getTokenizer(tokenizerName);

  if (maxLineCount !== undefined && maxLineCount < 0) {
    throw new Error('maxLineCount must be non-negative if defined');
  }
  if (maxTokenLength !== undefined && maxTokenLength < 0) {
    throw new Error('maxTokenLength must be non-negative if defined');
  }

  if (maxLineCount === 0 || maxTokenLength === 0) {
    return {
      context: '',
      lineCount: 0,
      tokenLength: 0,
      tokenizerName: tokenizerName,
    };
  }

  let context = doc.source.slice(0, doc.offset);

  if (maxLineCount !== undefined) {
    context = context.split('\n').slice(-maxLineCount).join('\n');
  }

  if (maxTokenLength !== undefined) {
    context = tokenizer.takeLastLinesTokens(context, maxTokenLength);
  }

  return {
    context: context,
    lineCount: context.split('\n').length,
    tokenLength: tokenizer.tokenLength(context),
    tokenizerName: tokenizerName,
  };
}

export interface CursorContext {
  context: string;
  lineCount: number;
  tokenLength: number;
  tokenizerName: string;
}
