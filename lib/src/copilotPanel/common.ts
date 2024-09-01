import "../textDocument.ts";

import { Position } from 'vscode-languageserver-types';
import { Context } from "../context.ts";
import { TextDocument, LocationFactory } from "../textDocument.ts";

function completionTypeToString(type: number): string {
  switch (type) {
    case 2:
      return 'open copilot';
    default:
      return 'unknown';
  }
}

function completionContextForDocument(ctx: Context, document: TextDocument, position: Position): CompletionContext {
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

  static fromJSONParse(
    ctx: Context,
    contextObj: {
      position: Position;
      completionType: number;
      appendToCompletion?: string;
      indentation?: string | null;
    }
  ): CompletionContext {
    const position = LocationFactory.position(contextObj.position.line, contextObj.position.character);
    const context = new CompletionContext(ctx, position, contextObj.completionType);
    if (contextObj.appendToCompletion !== undefined) {
      context.appendToCompletion = contextObj.appendToCompletion;
    }
    if (contextObj.indentation !== undefined) {
      context.indentation = contextObj.indentation;
    }
    return context;
  }
}

export { completionContextForDocument, solutionCountTarget, CompletionContext, completionTypeToString };
