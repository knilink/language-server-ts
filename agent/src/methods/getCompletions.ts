import { Type, type Static } from '@sinclair/typebox';
import type { Position, Range } from 'vscode-languageserver-types';

import { Context } from '../../../lib/src/context';
import { getOpenTextDocumentChecked } from '../textDocument';
import { verifyAuthenticated } from '../auth/authDecorator';
import { TelemetryData, telemetry } from '../../../lib/src/telemetry';
import { getTestCompletions } from './testing/setCompletionDocuments';
import { v4 as uuidv4 } from 'uuid';
import { StatusReporter } from '../../../lib/src/progress';
import { handleGhostTextResultTelemetry, mkCanceledResultTelemetry } from '../../../lib/src/ghostText/telemetry';
import { setLastShown } from '../../../lib/src/ghostText/last';
import { completionsFromGhostTextResults } from '../../../lib/src/ghostText/copilotCompletion';
import { CopilotCompletionCache } from '../copilotCompletionCache';
import { LocationFactory, TextDocument } from '../../../lib/src/textDocument';
import { getGhostText } from '../../../lib/src/ghostText/ghostText';
import { isAbortError } from '../../../lib/src/networking';
import { TestingOptions } from './testingOptions';
import { addMethodHandlerValidation } from '../schemaValidation';
import { type CancellationToken, CancellationTokenSource, MergedToken } from '../cancellation';
import { Logger, LogLevel } from '../../../lib/src/logger';

type _Completion = {
  uuid: string;
  text: string;
  displayText: string;
  position: Position;
  range: Range;
  docVersion: number;
};

let cancellationTokenSource: CancellationTokenSource | undefined;

const logger = new Logger(LogLevel.DEBUG, 'getCompletions');

const Params = Type.Object({
  doc: Type.Object({
    position: Type.Object({ line: Type.Number({ minimum: 0 }), character: Type.Number({ minimum: 0 }) }),
    insertSpaces: Type.Optional(Type.Boolean()),
    tabSize: Type.Optional(Type.Number()),
    uri: Type.String(),
    version: Type.Number(),
    ifInserted: Type.Optional(
      Type.Object({
        text: Type.String(),
        end: Type.Optional(Type.Object({ line: Type.Number({ minimum: 0 }), character: Type.Number({ minimum: 0 }) })),
        tooltipSignature: Type.Optional(Type.String()),
      })
    ),
  }),
  options: Type.Optional(TestingOptions),
});
type ParamsType = Static<typeof Params>;

async function handleGetCompletionsHelper(
  ctx: Context,
  clientToken: CancellationToken,
  params: ParamsType,
  isCycling: boolean
): Promise<
  | [
    {
      completions: _Completion[];
      cancellationReason?: 'CopilotNotAvailable' | 'DocumentVersionMismatch' | 'RequestCancelled' | 'OtherFailure';
    },
    null,
  ]
  | [null, { code: number; message: string }]
> {
  const docResultPromise = getOpenTextDocumentChecked(ctx, params.doc.uri);
  await verifyAuthenticated(ctx, clientToken);
  const telemetryData = TelemetryData.createAndMarkAsIssued();
  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }
  cancellationTokenSource = new CancellationTokenSource();
  const token = new MergedToken([clientToken, cancellationTokenSource.token]);
  const testCompletions = getTestCompletions(ctx, params.doc.position, isCycling);

  if (testCompletions) {
    return [
      {
        completions: testCompletions.map((completion) => ({
          uuid: uuidv4(),
          text: completion.insertText,
          displayText: completion.insertText,
          position: params.doc.position,
          range: completion.range,
          docVersion: params.doc.version,
        })),
      },
      null,
    ];
  }

  const docResult = await docResultPromise;
  if (docResult.status === 'notfound') {
    return [null, { code: -32602, message: docResult.message }];
  }
  if (docResult.status === 'invalid') {
    ctx.get(StatusReporter).setInactive(docResult.reason);
    return [{ completions: [], cancellationReason: 'CopilotNotAvailable' }, null];
  }
  let textDocument = docResult.document;

  if (textDocument.version !== params.doc.version) {
    await new Promise(setImmediate);
    const secondDocResult = await getOpenTextDocumentChecked(ctx, params.doc.uri);
    if (secondDocResult.status === 'valid' && secondDocResult.document.version === params.doc.version) {
      textDocument = secondDocResult.document;
    }
  }
  if (textDocument.version !== params.doc.version) {
    raiseVersionMismatchIfNotCanceled(ctx, token, textDocument, params.doc.version);
    return [{ completions: [], cancellationReason: 'DocumentVersionMismatch' }, null];
  }

  const position = positionAndContentForCompleting(
    ctx,
    telemetryData,
    textDocument,
    params.doc.position,
    params.doc.ifInserted?.end,
    params.doc.ifInserted
  );

  logCompletionLocation(ctx, textDocument, position);

  const resultWithTelemetry = await getGhostTextWithAbortHandling(
    ctx,
    textDocument,
    position,
    isCycling,
    telemetryData,
    token,
    params.doc.ifInserted
  );
  const result = await handleGhostTextResultTelemetry(ctx, resultWithTelemetry);

  if (!result) {
    return [{ completions: [], ...cancellationReason(resultWithTelemetry) }, null];
  }

  const [resultArray, resultType] = result;
  setLastShown(ctx, textDocument, position, resultType);

  const rawCompletions = completionsFromGhostTextResults(
    ctx,
    resultArray,
    resultType,
    textDocument,
    position,
    params.doc
  );

  const cache = ctx.get(CopilotCompletionCache);
  for (const completion of rawCompletions) {
    cache.set(completion.uuid, { ...completion, triggerCategory: 'ghostText' });
  }

  return [
    {
      completions: rawCompletions.map((rawCompletion) => ({
        uuid: rawCompletion.uuid,
        text: rawCompletion.insertText,
        range: rawCompletion.range,
        displayText: rawCompletion.displayText,
        position: rawCompletion.position,
        docVersion: textDocument.version,
      })),
    },
    null,
  ];
}

async function raiseVersionMismatchIfNotCanceled(
  ctx: Context,
  token: CancellationToken,
  textDocument: TextDocument,
  requestedVersion: number
): Promise<void> {
  if (!token.isCancellationRequested) {
    telemetryVersionMismatch(ctx, textDocument, requestedVersion);
    logger.debug(
      ctx,
      `Producing empty completions due to document version mismatch. Completions requested for document version ${requestedVersion} but document version was ${textDocument.version}.`
    );
  }
}

function positionAndContentForCompleting(
  ctx: Context,
  telemetryData: TelemetryData,
  textDocument: TextDocument,
  docPosition: Position,
  endRange = docPosition,
  ifInserted?: ParamsType['doc']['ifInserted']
): Position {
  let offset = textDocument.offsetAt(LocationFactory.position(docPosition.line, docPosition.character));
  let position = textDocument.positionAt(offset);

  if (ifInserted && ifInserted.text.length > 0 && textDocument instanceof TextDocument) {
    textDocument.update(
      [{ range: { start: docPosition, end: endRange }, text: ifInserted.text }],
      textDocument.version
    );
    position = textDocument.positionAt(offset + ifInserted.text.length);
    telemetryData.properties.completionsActive = 'true';
  }

  return position;
}

function logCompletionLocation(ctx: Context, textDocument: TextDocument, position: Position): void {
  const prefix = textDocument.getText({
    start: { line: Math.max(position.line - 1, 0), character: 0 },
    end: position,
  });
  const suffix = textDocument.getText({
    start: position,
    end: {
      line: Math.min(position.line + 2, textDocument.lineCount - 1),
      character: textDocument.lineCount - 1 > position.line ? 0 : position.character,
    },
  });
  logger.debug(
    ctx,
    `Requesting completion at position ${position.line}:${position.character}, between ${JSON.stringify(prefix)} and ${JSON.stringify(suffix)}.`
  );
}

async function telemetryVersionMismatch(
  ctx: Context,
  textDocument: TextDocument,
  requestedDocumentVersion: number
): Promise<void> {
  const data = TelemetryData.createAndMarkAsIssued({
    languageId: String(textDocument.languageId),
    requestedDocumentVersion: String(requestedDocumentVersion),
    actualDocumentVersion: String(textDocument.version),
  });
  telemetry(ctx, 'getCompletions.docVersionMismatch', data);
}

function cancellationReason(resultWithTelemetry: any): { cancellationReason?: 'RequestCancelled' | 'OtherFailure' } {
  switch (resultWithTelemetry.type) {
    case 'abortedBeforeIssued':
    case 'canceled':
      return { cancellationReason: 'RequestCancelled' };
    case 'failed':
      return { cancellationReason: 'OtherFailure' };
    default:
      return {};
  }
}

async function getGhostTextWithAbortHandling(
  requestCtx: Context,
  textDocument: TextDocument,
  position: Position,
  isCycling: boolean,
  telemetryData: TelemetryData,
  token: CancellationToken,
  ifInserted?: { text: string; end?: any }
): ReturnType<typeof getGhostText> {
  try {
    return await getGhostText(requestCtx, textDocument, position, isCycling, telemetryData, token, ifInserted);
  } catch (e) {
    if (isAbortError(e)) {
      return {
        type: 'canceled',
        reason: 'aborted at unknown location',
        telemetryData: mkCanceledResultTelemetry(telemetryData, { cancelledNetworkRequest: true }),
      };
    }
    throw e;
  }
}

const handleGetCompletions = addMethodHandlerValidation(
  Params,
  (ctx: Context, token: CancellationToken, params: ParamsType) => handleGetCompletionsHelper(ctx, token, params, false)
);

const handleGetCompletionsCycling = addMethodHandlerValidation(
  Params,
  (ctx: Context, token: CancellationToken, params: ParamsType) => handleGetCompletionsHelper(ctx, token, params, true)
);

export {
  logger,
  cancellationTokenSource,
  handleGetCompletions,
  handleGetCompletionsCycling,
  raiseVersionMismatchIfNotCanceled,
  positionAndContentForCompleting,
  logCompletionLocation,
  getGhostTextWithAbortHandling,
  ParamsType,
};
