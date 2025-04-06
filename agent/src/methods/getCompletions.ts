import type { Static } from '@sinclair/typebox';
import type { Position, Range } from 'vscode-languageserver-types';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../lib/src/context.ts';
import type { CopilotTextDocument } from '../../../lib/src/textDocument.ts';
import type { GhostTextResult } from '../../../lib/src/ghostText/ghostText.ts';

import { ResponseError, CancellationTokenSource } from 'vscode-languageserver/node.js';
import { getTestCompletions } from './testing/setCompletionDocuments.ts';
import { TestingOptions } from './testingOptions.ts';
import { MergedToken } from '../cancellation.ts';
import { setContextItems } from '../contextProvider.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { ErrorCode } from '../rpc.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { completionsFromGhostTextResults } from '../../../lib/src/ghostText/copilotCompletion.ts';
import { getGhostText } from '../../../lib/src/ghostText/ghostText.ts';
import { setLastShown } from '../../../lib/src/ghostText/last.ts';
import { handleGhostTextResultTelemetry } from '../../../lib/src/ghostText/telemetry.ts';
import { Logger } from '../../../lib/src/logger.ts';
import { LspContextItemSchema } from '../../../lib/src/prompt/contextProviders/contextItemSchemas.ts';
import { TelemetryData } from '../../../lib/src/telemetry.ts';
import { Type } from '@sinclair/typebox';
import { v4 as uuidv4 } from 'uuid';
import { DocumentUriSchema, PositionSchema } from '../../../types/src/core.ts';
import type {} from '../../../types/src/index.ts';

type _Completion = {
  uuid: string;
  text: string;
  displayText: string;
  position: Position;
  range: Range;
  docVersion: number;
};

let cancellationTokenSource: CancellationTokenSource | undefined;

const Params = Type.Object({
  doc: Type.Object({
    position: PositionSchema,
    insertSpaces: Type.Optional(Type.Boolean()),
    tabSize: Type.Optional(Type.Number()),
    uri: DocumentUriSchema,
    version: Type.Number(),
  }),
  contextItems: Type.Optional(LspContextItemSchema),
  options: Type.Optional(TestingOptions),
});
type ParamsType = Static<typeof Params>;

const logger = new Logger('getCompletions');

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
      result: [null, { code: number; message: string }];
    }
  | {
      type: 'earlyCancellation';
      result: [{ completions: []; cancellationReason: 'CopilotNotAvailable' | 'DocumentVersionMismatch' }, null];
    }
  | {
      type: 'ghostTextResult';
      resultWithTelemetry: GhostTextResult;
      textDocument: CopilotTextDocument;
      position: Position;
    };

async function fetchGhostText(
  ctx: Context,
  clientToken: CancellationToken,
  params: ParamsType,
  isCycling: boolean,
  promptOnly: boolean,
  telemetryData: TelemetryData
): Promise<GhostTextFetchResult> {
  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }

  cancellationTokenSource = new CancellationTokenSource();
  const token = new MergedToken([clientToken, cancellationTokenSource.token]);
  const testCompletions = getTestCompletions(ctx, params.doc.position, params.doc.uri, isCycling);
  if (testCompletions) {
    return {
      type: 'earlySuccess',
      result: [
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
      ],
    };
  }
  let textDocument: CopilotTextDocument;
  try {
    textDocument = await getOpenTextDocumentChecked(ctx, params.doc, token);
  } catch (e) {
    if (!(e instanceof ResponseError)) throw e;
    switch (e.code) {
      case ErrorCode.InvalidParams:
        return { type: 'earlyFailure', result: [null, { code: ErrorCode.InvalidParams, message: e.message }] };
      case ErrorCode.CopilotNotAvailable:
        return {
          type: 'earlyCancellation',
          result: [{ completions: [], cancellationReason: 'CopilotNotAvailable' }, null],
        };
      case ErrorCode.ContentModified:
        return {
          type: 'earlyCancellation',
          result: [{ completions: [], cancellationReason: 'DocumentVersionMismatch' }, null],
        };
    }
    throw e;
  }
  const position = params.doc.position;
  logCompletionLocation(ctx, textDocument, position);
  return {
    type: 'ghostTextResult',
    resultWithTelemetry: await getGhostText(ctx, textDocument, position, telemetryData, token, {
      isCycling,
      promptOnly,
    }),
    textDocument,
    position,
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
  const telemetryData = TelemetryData.createAndMarkAsIssued();

  if (params.contextItems) {
    setContextItems(ctx, params.contextItems);
  }

  const ghostTextFetchResult = await fetchGhostText(ctx, clientToken, params, isCycling, false, telemetryData);
  if (ghostTextFetchResult.type !== 'ghostTextResult') return ghostTextFetchResult.result;
  const { resultWithTelemetry, textDocument, position } = ghostTextFetchResult;
  const result = handleGhostTextResultTelemetry(ctx, resultWithTelemetry);
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

function logCompletionLocation(ctx: Context, textDocument: CopilotTextDocument, position: Position): void {
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

const handleGetCompletions = addMethodHandlerValidation(
  Params,
  (ctx: Context, token: CancellationToken, params: ParamsType) => handleGetCompletionsHelper(ctx, token, params, false)
);

const handleGetCompletionsCycling = addMethodHandlerValidation(
  Params,
  (ctx: Context, token: CancellationToken, params: ParamsType) => handleGetCompletionsHelper(ctx, token, params, true)
);

export { handleGetCompletions, handleGetCompletionsCycling, logCompletionLocation, logger };
