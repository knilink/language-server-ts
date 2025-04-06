import type { Context } from '../context.ts';
import type { Position } from 'vscode-languageserver-types';
import type { LanguageId } from '../../../prompt/src/types.ts';

import { promptLibProxy } from './promptLibProxy.ts';
import { Logger } from '../logger.ts';
import { LocationFactory, type CopilotTextDocument } from '../textDocument.ts';

type IndentationContext = {
  prev?: number;
  current: number;
  next?: number;
};

const parseBlockLogger = new Logger('parseBlock');

const continuations = ['\\{', '\\}', '\\[', '\\]', '\\(', '\\)'].concat(
  ['then', 'else', 'elseif', 'elif', 'catch', 'finally', 'fi', 'done', 'end', 'loop', 'until', 'where', 'when'].map(
    (s) => s + '\\b'
  )
);

const continuationRegex = new RegExp(`^(${continuations.join('|')})`);

let OfferNextLineCompletion: boolean = false;

function isEmptyBlockStart(doc: CopilotTextDocument, position: Position) {
  return promptLibProxy.isEmptyBlockStart(doc.languageId, doc.getText(), doc.offsetAt(position));
}

function parsingBlockFinishedExtended(
  ctx: Context,
  doc: CopilotTextDocument,
  position: Position,
  minLinesInBlock: number,
  maxLinesInBlock: number,
  maxLines: number
) {
  const prefix = doc.getText(LocationFactory.range(LocationFactory.position(0, 0), position));
  const offset = doc.offsetAt(position);
  const languageId = doc.languageId;
  let appendToPrefix = '';
  return async (completion: string) => {
    let blockEndOffset = await promptLibProxy.isBlockBodyFinished(
      languageId,
      prefix + appendToPrefix,
      completion.substring(appendToPrefix.length),
      offset + appendToPrefix.length
    );

    if (blockEndOffset) {
      blockEndOffset += appendToPrefix.length;
    }

    let completionLineCount = completion.split('\n').length;
    if (blockEndOffset) {
      let suggestedCompletion = completion.substring(0, blockEndOffset);

      let suggestedLineCount = suggestedCompletion.split('\n').length;

      parseBlockLogger.debug(
        ctx,
        `Current subset of completion finishes a block with suggestedLineCount: ${suggestedLineCount}, completionLineCount: ${completionLineCount}, suggestedCompletion: ${JSON.stringify(suggestedCompletion)}, whole completion: ${JSON.stringify(completion)}`
      );
      if (suggestedLineCount >= minLinesInBlock) {
        return blockEndOffset;
      }
      appendToPrefix = completion;
    }
    if (completionLineCount >= Math.max(maxLines, maxLinesInBlock)) {
      return completion.split('\n').slice(0, maxLines).join('\n').length;
    }
  };
}

function parsingBlockFinished(ctx: Context, doc: CopilotTextDocument, position: Position) {
  const prefix = doc.getText(LocationFactory.range(LocationFactory.position(0, 0), position));
  const offset = doc.offsetAt(position);
  const languageId = doc.languageId;

  return (completion: string) => promptLibProxy.isBlockBodyFinished(languageId, prefix, completion, offset);
}

async function getNodeStart(
  ctx: Context,
  doc: CopilotTextDocument,
  position: Position,
  completion: string
): Promise<Position | undefined> {
  const text = doc.getText(LocationFactory.range(LocationFactory.position(0, 0), position)) + completion;
  const offset = await promptLibProxy.getNodeStart(doc.languageId, text, doc.offsetAt(position));
  return offset ? doc.positionAt(offset) : undefined;
}

function isContinuationLine(line: string): boolean {
  return continuationRegex.test(line.trimStart().toLowerCase());
}

function indentationOfLine(line: string): number | undefined {
  const match = /^(\s*)([^]*)$/.exec(line);
  if (match && match[2] && match[2].length > 0) return match[1].length;
  return undefined;
}

function contextIndentation(doc: CopilotTextDocument, position: Position): IndentationContext {
  const source = doc.getText();
  const offset = doc.offsetAt(position);
  return contextIndentationFromText(source, offset, doc.languageId);
}

function contextIndentationFromText(source: string, offset: number, languageId: LanguageId): IndentationContext {
  const prevLines = source.slice(0, offset).split('\n');
  const nextLines = source.slice(offset).split('\n');

  function seekNonBlank(lines: string[], start: number, direction: number): [number | undefined, number | undefined] {
    let i = start;
    let ind: number | undefined;
    let indIdx: number | undefined;

    while (ind === undefined && i >= 0 && i < lines.length) {
      ind = indentationOfLine(lines[i]);
      indIdx = i;
      i += direction;
    }

    if (languageId === 'python' && direction === -1) {
      i++;
      const trimmedLine = lines[i].trim();
      if (trimmedLine.endsWith('"""')) {
        if (!(trimmedLine.startsWith('"""') && trimmedLine !== '"""')) {
          for (i--; i >= 0 && !lines[i].trim().startsWith('"""'); ) i--;
        }
        if (i >= 0) {
          for (ind = undefined, i--; ind === undefined && i >= 0; i--) {
            ind = indentationOfLine(lines[i]);
            indIdx = i;
          }
        }
      }
    }

    return [ind, indIdx];
  }

  const [current, currentIdx] = seekNonBlank(prevLines, prevLines.length - 1, -1);

  let prev: number | undefined;
  if (current !== undefined && currentIdx !== undefined) {
    for (let i = currentIdx - 1; i >= 0; i--) {
      const ind = indentationOfLine(prevLines[i]);
      if (ind !== undefined && ind < current) {
        prev = ind;
        break;
      }
    }
  }

  const [next] = seekNonBlank(nextLines, 1, 1);

  return { prev, current: current ?? 0, next: next };
}

function completionCutOrContinue(
  completion: string,
  contextIndentation: IndentationContext,
  previewText?: string
): 'continue' | number {
  const completionLines = completion.split('\n');
  const isContinuation = previewText !== undefined;
  const lastLineOfPreview = previewText?.split('\n').pop();
  let startLine = 0;

  if (isContinuation && lastLineOfPreview?.trim() && completionLines[0].trim()) {
    startLine++;
  }
  if (!isContinuation && OfferNextLineCompletion && completionLines[0].trim() === '') {
    startLine++;
  }
  if (isContinuation) {
    startLine++;
  }
  if (completionLines.length === startLine) return 'continue';

  const breakIndentation = Math.max(contextIndentation.current, contextIndentation.next ?? 0);
  for (let i = startLine; i < completionLines.length; i++) {
    let line = completionLines[i];
    if (i === 0 && lastLineOfPreview !== undefined) {
      line = lastLineOfPreview + line;
    }
    const ind = indentationOfLine(line);
    if (ind !== undefined && (ind < breakIndentation || (ind === breakIndentation && !isContinuationLine(line)))) {
      return completionLines.slice(0, i).join('\n').length;
    }
  }

  return 'continue';
}

function indentationBlockFinished(
  contextIndentation: IndentationContext,
  previewText?: string
): (completion: string) => Promise<number | undefined> {
  return async (completion: string) => {
    const res = completionCutOrContinue(completion, contextIndentation, previewText);
    return res === 'continue' ? undefined : res;
  };
}

export {
  contextIndentation,
  contextIndentationFromText,
  getNodeStart,
  indentationBlockFinished,
  isEmptyBlockStart,
  parsingBlockFinished,
  parsingBlockFinishedExtended,
};
