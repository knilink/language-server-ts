import type { Position } from 'vscode-languageserver-types';
import type { Completion } from '../types.ts';
import { CompletionResultType } from '../types.ts';
import type { Context } from '../context.ts';
import type { CopilotTextDocument } from '../textDocument.ts';
import type { TelemetryWithExp } from '../telemetry.ts';
import type { DocumentUri } from 'vscode-languageserver-types';

import { telemetryShown } from './telemetry.ts';
import { Logger } from '../logger.ts';
import { postInsertionTasks, postRejectionTasks } from '../postInsertion.ts';
import { computePartialLength } from '../suggestions/partialSuggestions.ts';
import type {} from './ghostText.ts';

type Rejection = {
  completionText: string;
  completionTelemetryData: TelemetryWithExp;
  offset: number;
};

const ghostTextLogger = new Logger('ghostText');

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
  document: CopilotTextDocument,
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
    resultType !== CompletionResultType.TypingAsSuggested
  ) {
    rejectLastShown(ctx, document.offsetAt(last.position));
  }
  last.setState(document, position);
  return last.index;
}

function handleGhostTextShown(ctx: Context, cmp: Completion): void {
  const last = ctx.get(LastGhostText);
  last.index = cmp.index;

  if (
    !last.shownCompletions.find((c) => c.index === cmp.index) &&
    cmp.uri === last.uri &&
    last.position?.line === cmp.position.line &&
    last.position?.character === cmp.position.character
  ) {
    last.shownCompletions.push(cmp);
  }
  if (cmp.displayText) {
    const fromCache = cmp.resultType !== CompletionResultType.Network;
    ghostTextLogger.debug(
      ctx,
      `[${cmp.telemetry.properties.headerRequestId as string}] shown choiceIndex: ${cmp.telemetry.properties.choiceIndex}, fromCache ${fromCache}`
    );
    cmp.telemetry.measurements.compCharLen = cmp.displayText.length;
    telemetryShown(ctx, 'ghostText', cmp);
  }
}

function handleGhostTextPostInsert(ctx: Context, cmp: Completion): void {
  const last = ctx.get(LastGhostText);
  last.resetState();
  ghostTextLogger.debug(ctx, 'Ghost text post insert');

  last.resetPartialAcceptanceState();
  return postInsertionTasks(
    ctx,
    'ghostText',
    cmp.displayText,
    cmp.offset,
    cmp.uri,
    cmp.telemetry,
    last.partiallyAcceptedLength
      ? { compType: 'partial', acceptedLength: cmp.displayText.length }
      : { compType: 'full' },
    cmp.range.start,
    cmp.copilotAnnotations
  );
}

function handlePartialGhostTextPostInsert(
  ctx: Context,
  cmp: Completion,
  acceptedLength: number,
  triggerKind: number = 0 // TODO enum
): void {
  const last = ctx.get(LastGhostText);
  if (acceptedLength === cmp.insertText.length) {
    last.resetState();
  }
  ghostTextLogger.debug(ctx, 'Ghost text partial post insert');
  const partialAcceptanceLength = computePartialLength(cmp, acceptedLength, triggerKind);
  if (partialAcceptanceLength) {
    last.partiallyAcceptedLength = acceptedLength;
    return postInsertionTasks(
      ctx,
      'ghostText',
      cmp.displayText,
      cmp.offset,
      cmp.uri,
      cmp.telemetry,
      { compType: 'partial', acceptedLength: partialAcceptanceLength },
      cmp.range.start,
      cmp.copilotAnnotations
    );
  }
}

class LastGhostText {
  private _position?: Position;
  private _uri?: DocumentUri;
  private _shownCompletions: Completion[] = [];
  partiallyAcceptedLength: number = 0;
  index?: number;

  get position(): Position | undefined {
    return this._position;
  }
  get shownCompletions(): Completion[] {
    return this._shownCompletions || [];
  }
  get uri(): DocumentUri | undefined {
    return this._uri;
  }

  resetState() {
    this._uri = undefined;
    this._position = undefined;
    this._shownCompletions = [];
  }

  setState({ uri }: { uri: DocumentUri }, position: Position) {
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
