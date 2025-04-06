import type { Position } from 'vscode-languageserver-types';
import type { Context } from '../context.ts';
import type { CopilotTextDocument } from '../textDocument.ts';

import { LocationFactory } from '../textDocument.ts';
import type {} from '../util/uri.ts';

// import { } '../lib/src/util/uri.ts';

function completionTypeToString(type: number): string {
  switch (type) {
    case 2:
      return 'open copilot';
    default:
      return 'unknown';
  }
}

function completionContextForDocument(
  ctx: Context,
  document: CopilotTextDocument,
  position: Position
): CompletionContext {
  let returnPosition = position;
  const line = document.lineAt(position.line);

  if (line.isEmptyOrWhitespace) {
    returnPosition = line.range.end;
  }

  return new CompletionContext(ctx, returnPosition, 2);
}

const solutionCountTarget = 10;

class CompletionContext {
  appendToCompletion: string;
  indentation: string | null;
  position: Position;
  completionType: number;

  // TODO: unused ctx, check abstract/interface
  constructor(ctx: Context, position: Position, completionType: number) {
    this.appendToCompletion = '';
    this.indentation = null;
    this.completionType = 2;
    this.position = LocationFactory.position(position.line, position.character);
    this.completionType = completionType;
  }
}

export { completionContextForDocument, solutionCountTarget, CompletionContext, completionTypeToString };
