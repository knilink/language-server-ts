import { fileURLToPath } from 'node:url';
import type { CopilotTextDocument } from '../../../../textDocument.ts';
import type { IChunking, DocumentChunk } from './IndexingTypes.ts';

import * as path from 'node:path';
import * as microjob from 'microjob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chunkSize = 500;
const overlap = Math.floor(0.25 * chunkSize);

class FixedSizeChunking implements IChunking {
  async chunk(doc: CopilotTextDocument, modelConfig: { tokenizer: string }): Promise<DocumentChunk[]> {
    let results = [];
    const filename =
      path.extname(__filename) === '.ts'
        ? path.resolve(__dirname, '../../../../../../dist/language-server.js')
        : __filename;

    results = results = await microjob.job(
      async ({ text, uri, tokenizerName, directory, chunkSize, overlap }) => {
        const tokenizer = require(directory).getTokenizer(tokenizerName);
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
            id: `${uri.toString()}#${tokenStart}`,
            chunk,
            tokenCount: chunkTokens.length,
            range: { start: chunkStart, end: chunkStart + chunk.length },
          });
          tokenStart = isLastChunk ? tokenEnd : tokenEnd - overlap;
        }

        return chunks;
      },
      {
        data: {
          text: doc.getText(),
          uri: doc.uri.toString(),
          tokenizerName: modelConfig.tokenizer,
          directory: filename,
          chunkSize,
          overlap,
        },
      }
    );

    return results;
  }
}

export { FixedSizeChunking };
