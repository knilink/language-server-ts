import { Position } from 'vscode-languageserver-types';

function parseChallengeDoc(
  challengeDoc: string,
  cursorPosition: Position
): { cursorLine: string; lines: string[]; start: Position; end: Position } {
  const lines = challengeDoc.split('\n');
  let start = cursorPosition;
  let end = cursorPosition;
  let cursorLine = lines[cursorPosition.line];
  const percentSignIndex = cursorLine.indexOf('%');

  if (percentSignIndex !== -1) {
    cursorLine = cursorLine.substring(0, percentSignIndex) + cursorLine.substring(percentSignIndex + 1);
    start = { line: cursorPosition.line, character: percentSignIndex };
  }

  const caretOneIndex = cursorLine.indexOf('^');

  if (caretOneIndex !== -1) {
    const caretTwoIndex = cursorLine.indexOf('^', caretOneIndex + 1);
    if (caretTwoIndex === -1) throw new Error('Challenge document must contain zero or two ^ characters.');

    cursorLine =
      cursorLine.substring(0, caretOneIndex) +
      cursorLine.substring(caretOneIndex + 1, caretTwoIndex) +
      cursorLine.substring(caretTwoIndex + 1);

    start = { line: cursorPosition.line, character: cursorPosition.character };
    end = { line: cursorPosition.line, character: cursorPosition.character + (caretTwoIndex - caretOneIndex - 1) };
  }

  return { cursorLine, lines, start, end };
}

export { parseChallengeDoc };
