import { TextDocument } from 'vscode-languageserver-textdocument';
import { IChunking } from './IndexingTypes';
import { getTokenizer } from '../../../../../../prompt/src/tokenization';

const chunkSize = 500;
const overlap = Math.floor(0.25 * chunkSize);

class FixedSizeChunking implements IChunking {
  async chunk(doc: TextDocument, modelConfig: { tokenizer: string }): Promise<{ id: string; chunk: string }[]> {
    const tokenizer = getTokenizer(modelConfig.tokenizer);
    const tokens: number[] = tokenizer.tokenize(doc.getText());
    const length = tokens.length;
    const chunks: { id: string; chunk: string }[] = [];
    let start = 0;

    while (start < length) {
      const isLastChunk = start + chunkSize >= length;
      const end = isLastChunk ? length : start + chunkSize;
      const chunkTokens = tokens.slice(start, end);
      const chunk = tokenizer.detokenize(chunkTokens);

      chunks.push({ id: `${doc.uri.toString()}#${start}`, chunk });
      start = isLastChunk ? end : end - overlap;
    }

    return chunks;
  }
}

export { FixedSizeChunking };
