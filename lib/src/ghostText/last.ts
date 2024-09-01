import { Position, Range } from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { Completion, CompletionResultType } from "../types.ts";
import { Context } from "../context.ts";
import { postRejectionTasks, postInsertionTasks } from "../postInsertion.ts";
import { telemetryShown } from "./telemetry.ts";
import { Logger, LogLevel } from "../logger.ts";
import { TextDocument } from "../textDocument.ts";
import { TelemetryWithExp } from "../telemetry.ts";

type Rejection = {
  completionText: string;
  completionTelemetryData: TelemetryWithExp;
  offset: number;
};

const ghostTextLogger = new Logger(LogLevel.INFO, 'ghostText');

function computeRejectedCompletions(last: LastGhostText): Rejection[] {
  let rejectedCompletions: Rejection[] = [];
  for (const c of last.shownCompletions) {
    if (c.displayText && c.telemetry) {
      const completionText = last.partiallyAcceptedLength
        ? c.displayText.substring(last.partiallyAcceptedLength - 1)
        : c.displayText;
      const completionTelemetryData = last.partiallyAcceptedLength
        ? c.telemetry.extendedBy({ compType: 'partial' }, { compCharLen: completionText.length })
        : c.telemetry;
      const rejection: Rejection = {
        completionText,
        completionTelemetryData,
        offset: c.offset,
      };
      rejectedCompletions.push(rejection);
    }
  }
  return rejectedCompletions;
}

function rejectLastShown(ctx: Context, offset?: number): void {
  const last = ctx.get(LastGhostText);
  if (!last.position || !last.uri) return;
  const rejectedCompletions = computeRejectedCompletions(last);
  if (rejectedCompletions.length > 0) {
    postRejectionTasks(ctx, 'ghostText', offset ?? rejectedCompletions[0].offset, last.uri, rejectedCompletions);
  }
  last.resetState();
  last.resetPartialAcceptanceState();
}

function setLastShown(
  ctx: Context,
  document: TextDocument,
  position: Position,
  resultType: CompletionResultType
): number | undefined {
  const last = ctx.get(LastGhostText);
  if (
    last.position &&
    last.uri &&
    !(
      last.position.line === position.line &&
      last.position.character === position.character &&
      last.uri.toString() === document.uri.toString()
    ) &&
    resultType !== CompletionResultType.UserTyping
  ) {
    rejectLastShown(ctx, document.offsetAt(last.position));
  }
  last.setState(document.vscodeUri, position);
  return last.index;
}

function handleGhostTextShown(ctx: Context, cmp: Completion): void {
  const last = ctx.get(LastGhostText);
  last.index = cmp.index;

  if (
    !last.shownCompletions.find((c) => c.index === cmp.index) &&
    `${cmp.file}` === `${last.uri}` &&
    last.position?.line === cmp.position.line &&
    last.position?.character === cmp.position.character
  ) {
    last.shownCompletions.push(cmp);
  }
  if (cmp.displayText) {
    const fromCache = cmp.resultType !== CompletionResultType.New;
    ghostTextLogger.debug(
      ctx,
      `[${cmp.telemetry.properties.headerRequestId as string}] shown choiceIndex: ${cmp.telemetry.properties.choiceIndex}, fromCache ${fromCache}`
    );
    cmp.telemetry.measurements.compCharLen = cmp.displayText.length;
    telemetryShown(ctx, 'ghostText', cmp.telemetry, fromCache);
  }
}

async function handleGhostTextPostInsert(ctx: Context, cmp: Completion): Promise<void> {
  const last = ctx.get(LastGhostText);
  last.resetState();
  ghostTextLogger.debug(ctx, 'Ghost text post insert');

  last.resetPartialAcceptanceState();
  await postInsertionTasks(
    ctx,
    'ghostText',
    cmp.displayText,
    cmp.offset,
    cmp.file,
    cmp.telemetry,
    last.partiallyAcceptedLength
      ? { compType: 'partial', acceptedLength: cmp.displayText.length }
      : { compType: 'full' },
    cmp.uuid,
    cmp.range.start
  );
}

function computePartialLength(cmp: Completion, acceptedLength: number): number {
  return cmp.displayText !== cmp.insertText && cmp.insertText.trim() === cmp.displayText
    ? acceptedLength
    : acceptedLength - cmp.range.end.character + cmp.range.start.character;
}

async function handlePartialGhostTextPostInsert(ctx: Context, cmp: Completion, acceptedLength: number): Promise<void> {
  const last = ctx.get(LastGhostText);
  if (acceptedLength === cmp.insertText.length) {
    last.resetState();
  }
  ghostTextLogger.debug(ctx, 'Ghost text partial post insert');
  const partialAcceptanceLength = computePartialLength(cmp, acceptedLength);
  if (partialAcceptanceLength) {
    last.partiallyAcceptedLength = acceptedLength;
    await postInsertionTasks(
      ctx,
      'ghostText',
      cmp.displayText,
      cmp.offset,
      cmp.file,
      cmp.telemetry,
      { compType: 'partial', acceptedLength: partialAcceptanceLength },
      cmp.uuid,
      cmp.range.start
    );
  }
}

class LastGhostText {
  private _position?: Position;
  private _uri?: URI;
  private _shownCompletions: Completion[] = [];
  partiallyAcceptedLength: number = 0;
  index?: number;

  get position(): Position | undefined {
    return this._position;
  }
  get shownCompletions(): Completion[] {
    return this._shownCompletions || [];
  }
  get uri(): URI | undefined {
    return this._uri;
  }

  resetState() {
    this._uri = undefined;
    this._position = undefined;
    this._shownCompletions = [];
  }

  setState(uri: URI, position: Position) {
    this._uri = uri;
    this._position = position;
    this._shownCompletions = [];
  }

  resetPartialAcceptanceState() {
    this.partiallyAcceptedLength = 0;
  }
}

export {
  ghostTextLogger,
  LastGhostText,
  setLastShown,
  handleGhostTextPostInsert,
  handleGhostTextShown,
  handlePartialGhostTextPostInsert,
  rejectLastShown,
};
