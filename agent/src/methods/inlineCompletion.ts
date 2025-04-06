import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Range } from 'vscode-languageserver-types';
import type { Context } from '../../../lib/src/context.ts';
import { InlineCompletionTriggerKind } from '../../../types/src/index.ts';
import type { CopilotInlineCompletionWithContextItemsType } from '../../../lib/src/prompt/contextProviders/contextItemSchemas.ts';

import { CancellationTokenSource } from 'vscode-languageserver/node.js';
import { logCompletionLocation, logger } from './getCompletions.ts';
import { getTestCompletions } from './testing/setCompletionDocuments.ts';
import { MergedToken } from '../cancellation.ts';
import { didAcceptCommand } from '../commands/completion.ts';
import { setContextItems } from '../contextProvider.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { ErrorCode } from '../rpc.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { completionsFromGhostTextResults } from '../../../lib/src/ghostText/copilotCompletion.ts';
import { getGhostText } from '../../../lib/src/ghostText/ghostText.ts';
import { positionAndContentForCompleting } from '../../../lib/src/ghostText/intellisense.ts';
import { setLastShown } from '../../../lib/src/ghostText/last.ts';
import { handleGhostTextResultTelemetry } from '../../../lib/src/ghostText/telemetry.ts';
import { CopilotInlineCompletionWithContextItemsSchema } from '../../../lib/src/prompt/contextProviders/contextItemSchemas.ts';
import { TelemetryData } from '../../../lib/src/telemetry.ts';
import { v4 as uuidv4 } from 'uuid';
import { CopilotInlineCompletionRequest } from '../../../types/src/inlineCompletion.ts';
import type {} from '../../../types/src/index.ts';

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
  params: CopilotInlineCompletionWithContextItemsType
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

  if (params.contextItems) {
    setContextItems(ctx, params.contextItems, params.data);
  }

  let testCompletions = getTestCompletions(ctx, params.position, params.textDocument.uri, isCycling);
  if (testCompletions) {
    return [{ items: testCompletions.map((completion) => ({ command: makeCommand(uuidv4()), ...completion })) }, null];
  }
  let textDocument = await getOpenTextDocumentChecked(ctx, params.textDocument, token);
  const completionInfo = params.context.selectedCompletionInfo;
  let position = params.position;
  let lineLengthIncrease = 0;

  if (completionInfo) {
    ({ position, textDocument, lineLengthIncrease } = positionAndContentForCompleting(
      telemetryData,
      textDocument,
      completionInfo
    ));
  }

  logCompletionLocation(ctx, textDocument, position);

  const resultWithTelemetry = await getGhostText(
    ctx,
    textDocument,
    position,
    telemetryData,
    token,
    { isCycling, ifInserted: completionInfo },
    params.data
  );

  const result = handleGhostTextResultTelemetry(ctx, resultWithTelemetry);
  if (clientToken.isCancellationRequested) {
    return [null, { code: ErrorCode.RequestCancelled, message: 'Request was canceled' }];
  }
  if (serverToken.isCancellationRequested) {
    return [null, { code: ErrorCode.ServerCancelled, message: 'Request was superseded by a new request' }];
  }
  if (!result)
    switch (resultWithTelemetry.type) {
      case 'abortedBeforeIssued':
      case 'canceled':
        return logger.debug(ctx, `Aborted: ${resultWithTelemetry.reason}`), [{ items: [] }, null];
      case 'failed':
        return [null, { code: ErrorCode.InternalError, message: resultWithTelemetry.reason }];
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
const handle = addMethodHandlerValidation(CopilotInlineCompletionWithContextItemsSchema, (ctx, token, params) =>
  handleChecked(ctx, token, params)
);

export { cancellationTokenSource, handle, type };
