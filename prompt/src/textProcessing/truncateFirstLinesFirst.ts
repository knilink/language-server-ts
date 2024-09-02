import { Element, Snippet } from '../types.ts';
import { ITokenizer } from '../tokenization/index.ts';

function truncateFirstLinesFirst(
  tokenizer: ITokenizer,
  snippet: Element,
  targetTokenBudget: number
): { summarizedElement: Element; removedMaterial: Element } {
  if (!targetTokenBudget)
    throw new Error('targetTokenBudget must be specified for the truncateFirstLinesFirst summarizer');

  let rawLines = snippet.text.split('\n');
  for (let i = 0; i < rawLines.length - 1; i++) {
    rawLines[i] += '\n';
  }

  const lines: string[] = [];
  rawLines.forEach((line) => {
    if (line === '\n' && lines.length > 0 && !lines[lines.length - 1].endsWith('\n\n')) {
      lines[lines.length - 1] += '\n';
    } else {
      lines.push(line);
    }
  });

  const lineTokens = lines.map((line) => tokenizer.tokenLength(line));
  let i = 1;
  let tokens = 0;

  for (; i <= lineTokens.length; i++) {
    const t = lineTokens[lineTokens.length - i];
    if (t) {
      if (t + tokens > targetTokenBudget) {
        i--;
        break;
      }
      tokens += t;
    }
  }

  const truncatedText = lines.slice(-i).join('');
  const newTokens = tokenizer.tokenLength(truncatedText);
  const removedText = lines.slice(0, -i).join('');
  const removedTokens = tokenizer.tokenLength(removedText);

  const summarizedElement: Element = {
    id: snippet.id,
    kind: snippet.kind,
    text: truncatedText,
    tokens: newTokens,
    score: snippet.score,
  };

  const removedMaterial: Element = {
    ...snippet,
    tokens: removedTokens,
  };

  return { summarizedElement, removedMaterial };
}

export { truncateFirstLinesFirst };
