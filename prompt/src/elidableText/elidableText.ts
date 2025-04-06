import { CurrentDocument } from '../types.ts';
import { ITokenizer, getTokenizer } from '../tokenization/index.ts';

import { elidableTextForSourceCode } from './fromSourceCode.ts'; // circular deps
import { LineWithValueAndCost } from './lineWithValueAndCost.ts';

function makePrompt(
  lines: LineWithValueAndCost[],
  maxTokens: number,
  ellipsis: string,
  indentEllipses: boolean,
  strategy: 'removeLeastBangForBuck' | 'removeLeastDesirable',
  tokenizer: ITokenizer
): string {
  if (tokenizer.tokenLength(ellipsis + `\n`) > maxTokens) {
    throw new Error('maxTokens must be larger than the ellipsis length');
  }

  if (strategy === 'removeLeastBangForBuck') {
    lines.forEach((line) => line.adjustValue(1 / line.cost));
  }

  const infiniteWorth = lines.reduce((a, b) => Math.max(a, b.value), 0) + 1;
  const infiniteIndentation = lines.reduce((a, b) => Math.max(a, b.text.length), 0) + 1;
  const trimmedEllipsis = ellipsis.trim();
  let totalCost = lines.reduce((sum, line) => sum + line.cost, 0);
  let defensiveCounter = lines.length + 1;

  while (totalCost > maxTokens && defensiveCounter-- >= -1) {
    const leastDesirableLine = lines.reduce((prev, current) => (current.value < prev.value ? current : prev));

    let index = lines.indexOf(leastDesirableLine);

    let mostRecentNonBlankLine = lines
      .slice(0, index + 1)
      .reverse()
      .find((line) => line.text.trim() !== '') || { text: '' };

    let indentation = 0;
    if (indentEllipses) {
      indentation = Math.min(
        mostRecentNonBlankLine.text.match(/^\s*/)?.[0].length ?? 0,
        lines[index - 1]?.text.trim() === trimmedEllipsis
          ? (lines[index - 1]?.text.match(/^\s*/)?.[0].length ?? 0)
          : infiniteIndentation,
        lines[index + 1]?.text.trim() === trimmedEllipsis
          ? (lines[index + 1]?.text.match(/^\s*/)?.[0].length ?? 0)
          : infiniteIndentation
      );
    }

    const insert = ' '.repeat(indentation) + ellipsis;
    const newEllipis = new LineWithValueAndCost(insert, infiniteWorth, tokenizer.tokenLength(insert + `\n`), 'loose');
    lines.splice(index, 1, newEllipis);

    if (lines[index + 1]?.text.trim() === trimmedEllipsis) {
      lines.splice(index + 1, 1);
    }
    if (lines[index - 1]?.text.trim() === trimmedEllipsis) {
      lines.splice(index - 1, 1);
    }
    const newTotalCost = lines.reduce((sum, line) => sum + line.cost, 0);
    if (newTotalCost >= totalCost && lines.every((line) => line.value === infiniteWorth)) {
      indentEllipses = false;
    }
    totalCost = newTotalCost;
  }

  if (defensiveCounter < 0)
    throw new Error(
      'Infinite loop in ElidableText.makePrompt: Defensive counter < 0 in ElidableText.makePrompt with end text'
    );
  const resultLines: string[] = [];
  for (const line of lines) {
    resultLines.push(line.text);
  }

  return lines.map((line) => line.text).join(`\n`);
}

class ElidableText {
  public lines: LineWithValueAndCost[];

  constructor(chunks: ElidableText.Chunk[]) {
    this.lines = [];

    for (const chunk of chunks) {
      const value = Array.isArray(chunk) ? chunk[1] : 1;
      const input = Array.isArray(chunk) ? chunk[0] : chunk;

      if (typeof input === 'string') {
        input.split('\n').forEach((line: string) => this.lines.push(new LineWithValueAndCost(line, value)));
      } else if (input instanceof ElidableText) {
        input.lines.forEach((line: LineWithValueAndCost) => this.lines.push(line.copy().adjustValue(value)));
      } else if ('source' in input && 'languageId' in input) {
        elidableTextForSourceCode(input).lines.forEach((line: LineWithValueAndCost) =>
          this.lines.push(line.copy().adjustValue(value))
        );
      }
    }
  }

  adjust(multiplier: number): void {
    this.lines.forEach((line: LineWithValueAndCost) => line.adjustValue(multiplier));
  }

  recost(coster: (x: string) => number = (x: string) => getTokenizer().tokenLength(x + '\n')): void {
    this.lines.forEach((line: LineWithValueAndCost) => line.recost(coster));
  }

  makePrompt(
    maxTokens: number,
    ellipsis = '[...]',
    indentEllipses = true,
    strategy: 'removeLeastBangForBuck' | 'removeLeastDesirable' = 'removeLeastDesirable',
    tokenizer = getTokenizer()
  ): string {
    const linesCopy: LineWithValueAndCost[] = this.lines.map((line) => line.copy());
    return makePrompt(linesCopy, maxTokens, ellipsis, indentEllipses, strategy, tokenizer);
  }
}

namespace ElidableText {
  export type Chunk = string | ElidableText | CurrentDocument | [string | ElidableText | CurrentDocument, number];
}

export { ElidableText };
