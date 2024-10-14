import { type TextDocument } from '../../../../textDocument.ts';
import { IChunking, DocumentChunk } from './IndexingTypes.ts';
import { getTokenizer } from '../../../../../../prompt/src/tokenization/index.ts';

const chunkSize = 500;
const overlap = Math.floor(0.25 * chunkSize);

class FixedSizeChunking implements IChunking {
  async chunk(doc: TextDocument, modelConfig: { tokenizer: string }): Promise<DocumentChunk[]> {
    const tokenizer = getTokenizer(modelConfig.tokenizer);
    const text = doc.getText();
    const tokens = tokenizer.tokenize(text);
    const length = tokens.length;
    const chunks: DocumentChunk[] = [];

    let tokenStart = 0;
    while (tokenStart < length) {
      const isLastChunk = tokenStart + chunkSize >= length;
      const tokenEnd = isLastChunk ? length : tokenStart + chunkSize;
      const chunkTokens = tokens.slice(tokenStart, tokenEnd);
      const chunk = tokenizer.detokenize(chunkTokens);
      const chunkStart = text.indexOf(chunk);
      chunks.push({
        id: `${doc.uri.toString()}#${tokenStart}`,
        chunk,
        tokenCount: chunkTokens.length,
        range: { start: chunkStart, end: chunkStart + chunk.length },
      });
      tokenStart = isLastChunk ? tokenEnd : tokenEnd - overlap;
    }

    return chunks;
  }
}

export { FixedSizeChunking };
