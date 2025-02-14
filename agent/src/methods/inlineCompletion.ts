// import { } from '../rpc';

import { v4 as uuidv4 } from 'uuid';

import { type CancellationToken } from '../cancellation.ts';
import { Type, type Static } from '@sinclair/typebox';
import type { Range } from 'vscode-languageserver-types';
import { InlineCompletionRequest } from 'vscode-languageserver/node.js';

import { Context } from '../../../lib/src/context.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { TelemetryData } from '../../../lib/src/telemetry.ts';
import { getTestCompletions } from './testing/setCompletionDocuments.ts';
import {
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
import {
  CopilotInlineCompletionParams,
  CopilotInlineCompletionParamsType,
  CopilotInlineCompletionRequest,
  InlineCompletionTriggerKind,
} from '../../../types/src/index.ts';

type Item = {
  command: {
    title: string;
    command: string;
    arguments: [string];
  };
  insertText: string;
  range: Range;
};

let cancellationTokenSource: CancellationTokenSource | undefined;

function makeCommand(id: string): Item['command'] {
  return { title: 'Completion accepted', command: didAcceptCommand, arguments: [id] };
}

async function handleChecked(
  ctx: Context,
  clientToken: CancellationToken,
  params: CopilotInlineCompletionParamsType
): Promise<[{ items: Item[] }, null] | [null, { code: number; message: string }]> {
  let telemetryData = TelemetryData.createAndMarkAsIssued();

  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }

  const isCycling = params.context.triggerKind === InlineCompletionTriggerKind.Invoked;
  cancellationTokenSource = new CancellationTokenSource();
  const serverToken = cancellationTokenSource.token;
  const token = new MergedToken([clientToken, serverToken]);
  const testCompletions = getTestCompletions(ctx, params.position, isCycling);
  if (testCompletions) {
    return [{ items: testCompletions.map((completion) => ({ command: makeCommand(uuidv4()), ...completion })) }, null];
  }
  let textDocument = await getOpenTextDocumentChecked(ctx, params.textDocument, token);
  const completionInfo = params.context.selectedCompletionInfo;
  let position = params.position;
  let lineLengthIncrease = 0;

  if (completionInfo) {
    ({ position, textDocument, lineLengthIncrease } = positionAndContentForCompleting(
      ctx,
      telemetryData,
      textDocument,
      completionInfo.range.start,
      completionInfo.range.end,
      completionInfo
    ));
  }

  logCompletionLocation(ctx, textDocument, position);
  let resultWithTelemetry = await getGhostTextWithAbortHandling(
    ctx,
    textDocument,
    position,
    isCycling,
    telemetryData,
    token,
    completionInfo,
    false,
    params.data
  );
  let result = await handleGhostTextResultTelemetry(ctx, resultWithTelemetry);
  if (clientToken.isCancellationRequested) return [null, { code: -32800, message: 'Request was canceled' }];
  if (serverToken.isCancellationRequested)
    return [null, { code: -32802, message: 'Request was superseded by a new request' }];
  if (!result)
    switch (resultWithTelemetry.type) {
      case 'abortedBeforeIssued':
      case 'canceled':
        return logger.debug(ctx, `Aborted: ${resultWithTelemetry.reason}`), [{ items: [] }, null];
      case 'failed':
        return [null, { code: -32603, message: resultWithTelemetry.reason }];
      default:
        return [{ items: [] }, null];
    }
  let [resultArray, resultType] = result;
  setLastShown(ctx, textDocument, position, resultType);
  let rawCompletions = completionsFromGhostTextResults(
    ctx,
    resultArray,
    resultType,
    textDocument,
    position,
    params.formattingOptions
  );
  let cache = ctx.get(CopilotCompletionCache);
  for (let completion of rawCompletions) cache.set(completion.uuid, { ...completion, triggerCategory: 'ghostText' });
  return [
    {
      items: rawCompletions.map((rawCompletion) => {
        let range = { ...rawCompletion.range, end: { ...rawCompletion.range.end } };
        range.end.character -= lineLengthIncrease;
        return { command: makeCommand(rawCompletion.uuid), insertText: rawCompletion.insertText, range: range };
      }),
    },
    null,
  ];
}

const type = CopilotInlineCompletionRequest.type;
const handle = addMethodHandlerValidation(CopilotInlineCompletionParams, (ctx, token, params) =>
  handleChecked(ctx, token, params)
);

export { cancellationTokenSource, handle, type };
