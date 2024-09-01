import { elidableTextForSourceCode } from "../../../../prompt/src/elidableText/fromSourceCode.ts";
import { ElidableText } from "../../../../prompt/src/elidableText/elidableText.ts";

function fromMessage(message: string): ElidableText {
  const lines = message.split('\n');
  const chunks: [ElidableText, number][] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        chunks.push([elidableTextForSourceCode(codeBlockLines.join('\n')), 1]);
        codeBlockLines = [];
        chunks.push([new ElidableText([line]), 1]);
      } else {
        chunks.push([new ElidableText([line]), 1]);
      }
      inCodeBlock = !inCodeBlock;
    } else if (inCodeBlock) {
      codeBlockLines.push(line);
    } else {
      chunks.push([new ElidableText([line]), 0.8]);
    }
  }

  if (inCodeBlock) {
    chunks.push([elidableTextForSourceCode(codeBlockLines.join('\n')), 1]);
    chunks.push([new ElidableText(['```']), 1]);
  }

  return new ElidableText(chunks);
}

export { fromMessage };
