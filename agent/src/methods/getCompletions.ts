import { Type, type Static } from '@sinclair/typebox';
import type { Position, Range } from 'vscode-languageserver-types';
import { ResponseError } from 'vscode-languageserver';
import { v4 } from 'uuid';

import { Context } from '../../../lib/src/context.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { getTestCompletions } from './testing/setCompletionDocuments.ts';
import { handleGhostTextResultTelemetry, mkCanceledResultTelemetry } from '../../../lib/src/ghostText/telemetry.ts';
import { setLastShown } from '../../../lib/src/ghostText/last.ts';
import { completionsFromGhostTextResults } from '../../../lib/src/ghostText/copilotCompletion.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { TelemetryData } from '../../../lib/src/telemetry.ts';
import { LocationFactory, TextDocument } from '../../../lib/src/textDocument.ts';
import { getGhostText, GhostTextResult } from '../../../lib/src/ghostText/ghostText.ts';
import { isAbortError } from '../../../lib/src/networking.ts';
import { TestingOptions } from './testingOptions.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { type CancellationToken, CancellationTokenSource, MergedToken } from '../cancellation.ts';
import { Logger, LogLevel } from '../../../lib/src/logger.ts';

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

export type Result = {
  uuid: string;
  text: string;
  displayText: string;
  position: Position;
  range: Range;
  docVersion: number;
};

type GhostTextFetchResult =
  | {
      type: 'earlySuccess';
      result: [{ completions: Result[] }, null];
    }
  | {
      type: 'earlyFailure';
      result: [null, { code: -32602; message: string }];
    }
  | {
      type: 'earlyCancellation';
      result: [{ completions: []; cancellationReason: 'CopilotNotAvailable' | 'DocumentVersionMismatch' }, null];
    }
  | {
      type: 'ghostTextResult';
      resultWithTelemetry: GhostTextResult;
      textDocument: TextDocument;
      position: Position;
      lineLengthIncrease: number;
    };

async function fetchGhostText(
  ctx: Context,
  clientToken: CancellationToken,
  params: ParamsType,
  isCycling: boolean,
  promptOnly: boolean
): Promise<GhostTextFetchResult> {
  let telemetryData = TelemetryData.createAndMarkAsIssued();

  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }

  cancellationTokenSource = new CancellationTokenSource();
  let token = new MergedToken([clientToken, cancellationTokenSource.token]);
  let testCompletions = getTestCompletions(ctx, params.doc.position, isCycling);
  if (testCompletions) {
    return {
      type: 'earlySuccess',
      result: [
        {
          completions: testCompletions.map((completion) => ({
            uuid: v4(),
            text: completion.insertText,
            displayText: completion.insertText,
            position: params.doc.position,
            range: completion.range,
            docVersion: params.doc.version,
          })),
        },
        null,
      ],
    };
  }
  let textDocument: TextDocument;
  try {
    textDocument = await getOpenTextDocumentChecked(ctx, params.doc, token);
  } catch (e) {
    if (!(e instanceof ResponseError)) throw e;
    switch (e.code) {
      case -32602:
        return { type: 'earlyFailure', result: [null, { code: -32602, message: e.message }] };
      case 1002:
        return {
          type: 'earlyCancellation',
          result: [{ completions: [], cancellationReason: 'CopilotNotAvailable' }, null],
        };
      case -32801:
        return {
          type: 'earlyCancellation',
          result: [{ completions: [], cancellationReason: 'DocumentVersionMismatch' }, null],
        };
    }
    throw e;
  }
  const { position, lineLengthIncrease, ...andContent } = positionAndContentForCompleting(
    ctx,
    telemetryData,
    textDocument,
    params.doc.position,
    params.doc.ifInserted?.end,
    params.doc.ifInserted
  );
  textDocument = andContent.textDocument;
  logCompletionLocation(ctx, textDocument, position);
  return {
    type: 'ghostTextResult',
    resultWithTelemetry: await getGhostTextWithAbortHandling(
      ctx,
      textDocument,
      position,
      isCycling,
      telemetryData,
      token,
      params.doc.ifInserted,
      promptOnly
    ),
    textDocument,
    position,
    lineLengthIncrease,
  };
}

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
  const ghostTextFetchResult = await fetchGhostText(ctx, clientToken, params, isCycling, false);
  if (ghostTextFetchResult.type !== 'ghostTextResult') return ghostTextFetchResult.result;
  const { resultWithTelemetry, textDocument, position, lineLengthIncrease } = ghostTextFetchResult;
  const result = await handleGhostTextResultTelemetry(ctx, resultWithTelemetry);
  if (!result) return [{ completions: [], ...cancellationReason(resultWithTelemetry) }, null];
  const [resultArray, resultType] = result;
  setLastShown(ctx, textDocument, position, resultType);
  let rawCompletions = completionsFromGhostTextResults(
    ctx,
    resultArray,
    resultType,
    textDocument,
    position,
    params.doc
  );
  const cache = ctx.get(CopilotCompletionCache);
  for (const completion of rawCompletions) cache.set(completion.uuid, { ...completion, triggerCategory: 'ghostText' });
  return [
    {
      completions: rawCompletions.map((rawCompletion) => {
        let range = { ...rawCompletion.range, end: { ...rawCompletion.range.end } };
        range.end.character -= lineLengthIncrease;
        return {
          uuid: rawCompletion.uuid,
          text: rawCompletion.insertText,
          range,
          displayText: rawCompletion.displayText,
          position: rawCompletion.position,
          docVersion: textDocument.version,
        };
      }),
    },
    null,
  ];
}

function positionAndContentForCompleting(
  ctx: Context,
  telemetryData: TelemetryData,
  textDocument: TextDocument,
  docPosition: Position,
  endRange = docPosition,
  ifInserted?: ParamsType['doc']['ifInserted']
): { position: Position; textDocument: TextDocument; lineLengthIncrease: number } {
  const offset = textDocument.offsetAt(LocationFactory.position(docPosition.line, docPosition.character));
  let position = textDocument.positionAt(offset);
  let lineLengthIncrease = 0;

  if (ifInserted && ifInserted?.text.length > 0) {
    textDocument = TextDocument.withChanges(
      textDocument,
      [{ range: { start: docPosition, end: endRange }, text: ifInserted.text }],
      textDocument.version
    );
    position = textDocument.positionAt(offset + ifInserted.text.length);
    lineLengthIncrease = ifInserted.text.length - (endRange.character - docPosition.character);
    telemetryData.properties.completionsActive = 'true';
  }

  return { position, textDocument, lineLengthIncrease };
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

function cancellationReason(resultWithTelemetry: GhostTextResult):
  | {
      cancellationReason?: 'RequestCancelled' | 'OtherFailure';
    }
  | undefined {
  switch (resultWithTelemetry.type) {
    case 'abortedBeforeIssued':
    case 'canceled':
      return { cancellationReason: 'RequestCancelled' };
    case 'failed':
      return { cancellationReason: 'OtherFailure' };
    default:
      return;
  }
}

async function getGhostTextWithAbortHandling(
  requestCtx: Context,
  textDocument: TextDocument,
  position: Position,
  isCycling: boolean,
  telemetryData: TelemetryData,
  token: CancellationToken,
  ifInserted?: ParamsType['doc']['ifInserted'],
  promptOnly?: boolean
): Promise<GhostTextResult> {
  try {
    return await getGhostText(
      requestCtx,
      textDocument,
      position,
      isCycling,
      telemetryData,
      token,
      ifInserted,
      promptOnly
    );
  } catch (e) {
    if (isAbortError(e))
      return {
        type: 'canceled',
        reason: 'aborted at unknown location',
        telemetryData: mkCanceledResultTelemetry(telemetryData, { cancelledNetworkRequest: true }),
      };
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
  Params,
  ParamsType,
  cancellationReason,
  fetchGhostText,
  getGhostTextWithAbortHandling,
  handleGetCompletions,
  handleGetCompletionsCycling,
  logCompletionLocation,
  logger,
  positionAndContentForCompleting,
};
