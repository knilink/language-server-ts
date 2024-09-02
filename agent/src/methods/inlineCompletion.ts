// import { } from '../rpc';

import { v4 as uuidv4 } from 'uuid';

import { type CancellationToken } from '../cancellation.ts';
import { Type, type Static } from '@sinclair/typebox';
import type { Range } from 'vscode-languageserver-types';
import { InlineCompletionRequest } from 'vscode-languageserver/node.js';

import { Context } from '../../../lib/src/context.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { verifyAuthenticated } from '../auth/authDecorator.ts';
import { TelemetryData } from '../../../lib/src/telemetry.ts';
import { getTestCompletions } from './testing/setCompletionDocuments.ts';
import {
  raiseVersionMismatchIfNotCanceled,
  positionAndContentForCompleting,
  logCompletionLocation,
  getGhostTextWithAbortHandling,
  logger,
} from './getCompletions.ts';
import { handleGhostTextResultTelemetry } from '../../../lib/src/ghostText/telemetry.ts';
import { setLastShown } from '../../../lib/src/ghostText/last.ts';
import { completionsFromGhostTextResults } from '../../../lib/src/ghostText/copilotCompletion.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { CancellationTokenSource, MergedToken } from '../cancellation.ts';
import { didAcceptCommand } from '../commands/completion.ts';

const type = InlineCompletionRequest.type;

type Item = {
  command: {
    title: string;
    command: string;
    arguments: [string];
  };
  insertText: string;
  range: Range;
};

const Params = Type.Object({
  textDocument: Type.Object({ uri: Type.String(), version: Type.Optional(Type.Number()) }),
  position: Type.Object({ line: Type.Number({ minimum: 0 }), character: Type.Number({ minimum: 0 }) }),
  formattingOptions: Type.Optional(
    Type.Object({ tabSize: Type.Integer({ minimum: 1 }), insertSpaces: Type.Boolean() })
  ),
  context: Type.Object({
    triggerKind: Type.Integer(),
    selectedCompletionInfo: Type.Optional(
      Type.Object({
        text: Type.String(),
        range: Type.Object({
          start: Type.Object({ line: Type.Number(), character: Type.Number() }),
          end: Type.Object({ line: Type.Number(), character: Type.Number() }),
        }),
        tooltipSignature: Type.Optional(Type.String()),
      })
    ),
  }),
});

type ParamsType = Static<typeof Params>;

let cancellationTokenSource: CancellationTokenSource | undefined;

function makeCommand(id: string): Item['command'] {
  return { title: 'Completion accepted', command: didAcceptCommand, arguments: [id] };
}

async function handleChecked(
  ctx: Context,
  clientToken: CancellationToken,
  params: ParamsType
): Promise<[{ items: Item[] }, null] | [null, { code: number; message: string }]> {
  const docResultPromise = getOpenTextDocumentChecked(ctx, params.textDocument.uri);
  await verifyAuthenticated(ctx, clientToken);
  const telemetryData = TelemetryData.createAndMarkAsIssued();

  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }

  const isCycling = params.context.triggerKind === 1;
  cancellationTokenSource = new CancellationTokenSource();
  const serverToken = cancellationTokenSource.token;
  const token = new MergedToken([clientToken, serverToken]);
  const testCompletions = getTestCompletions(ctx, params.position, isCycling);

  if (testCompletions) {
    return [
      {
        items: testCompletions.map((completion) => ({
          command: makeCommand(uuidv4()),
          ...completion,
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
    return [null, { code: 1002, message: docResult.reason }];
  }

  let textDocument = docResult.document;
  if (params.textDocument.version !== undefined && textDocument.version !== params.textDocument.version) {
    await new Promise(setImmediate);
    const secondDocResult = await getOpenTextDocumentChecked(ctx, params.textDocument.uri);
    if (secondDocResult.status === 'valid' && secondDocResult.document.version === params.textDocument.version) {
      textDocument = secondDocResult.document;
    }
  }

  if (params.textDocument.version !== undefined && textDocument.version !== params.textDocument.version) {
    raiseVersionMismatchIfNotCanceled(ctx, token, textDocument, params.textDocument.version);
    return [null, { code: -32801, message: 'Document Version Mismatch' }];
  }

  let completionInfo = params.context.selectedCompletionInfo;
  let position = params.position;

  if (completionInfo) {
    position = positionAndContentForCompleting(
      ctx,
      telemetryData,
      textDocument,
      completionInfo.range.start,
      completionInfo.range.end,
      completionInfo
    );
  }

  logCompletionLocation(ctx, textDocument, position);

  const resultWithTelemetry = await getGhostTextWithAbortHandling(
    ctx,
    textDocument,
    position,
    isCycling,
    telemetryData,
    token,
    completionInfo
  );

  const result = await handleGhostTextResultTelemetry(ctx, resultWithTelemetry);

  if (clientToken.isCancellationRequested) {
    return [null, { code: -32800, message: 'Request was canceled' }];
  }
  if (serverToken.isCancellationRequested) {
    return [null, { code: -32802, message: 'Request was superseded by a new request' }];
  }

  if (!result) {
    switch (resultWithTelemetry.type) {
      case 'abortedBeforeIssued':
      case 'canceled':
        logger.debug(ctx, `Aborted: ${resultWithTelemetry.reason}`);
        return [{ items: [] }, null];
      case 'failed':
        return [null, { code: -32603, message: resultWithTelemetry.reason }];
      default:
        return [{ items: [] }, null];
    }
  }

  const [resultArray, resultType] = result;
  setLastShown(ctx, textDocument, position, resultType);

  const rawCompletions = completionsFromGhostTextResults(
    ctx,
    resultArray,
    resultType,
    textDocument,
    position,
    params.formattingOptions
  );

  const cache = ctx.get(CopilotCompletionCache);
  for (const completion of rawCompletions) {
    cache.set(completion.uuid, { ...completion, triggerCategory: 'ghostText' });
  }

  return [
    {
      items: rawCompletions.map((rawCompletion) => ({
        command: makeCommand(rawCompletion.uuid),
        insertText: rawCompletion.insertText,
        range: rawCompletion.range,
      })),
    },
    null,
  ];
}

const handle = addMethodHandlerValidation(Params, (ctx: Context, token: CancellationToken, params: ParamsType) =>
  handleChecked(ctx, token, params)
);

export { cancellationTokenSource, handle, type };
