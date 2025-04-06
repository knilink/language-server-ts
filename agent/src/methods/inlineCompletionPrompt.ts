import type { Context } from '../../../lib/src/context.ts';
import { CancellationTokenSource } from 'vscode-languageserver/node.js';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import { InlineCompletionTriggerKind } from '../../../types/src/index.ts';
import type { CopilotInlineCompletionWithContextItemsType } from '../../../lib/src/prompt/contextProviders/contextItemSchemas.ts';
import type { ExtractedPrompt } from '../../../lib/src/prompt/prompt.ts';

import { MergedToken } from '../cancellation.ts';
import { setContextItems } from '../contextProvider.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { getGhostText } from '../../../lib/src/ghostText/ghostText.ts';
import { positionAndContentForCompleting } from '../../../lib/src/ghostText/intellisense.ts';
import { CopilotInlineCompletionWithContextItemsSchema } from '../../../lib/src/prompt/contextProviders/contextItemSchemas.ts';
import { TelemetryData } from '../../../lib/src/telemetry.ts';
import { CopilotInlineCompletionPromptRequest } from '../../../types/src/inlineCompletionPrompt.ts';

let cancellationTokenSource: CancellationTokenSource;

async function handleChecked(
  ctx: Context,
  clientToken: CancellationToken,
  params: CopilotInlineCompletionWithContextItemsType
): Promise<[{ prompt: ExtractedPrompt }, null]> {
  const telemetryData = TelemetryData.createAndMarkAsIssued();

  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }

  const isCycling = params.context.triggerKind === InlineCompletionTriggerKind.Invoked;
  cancellationTokenSource = new CancellationTokenSource();
  const serverToken = cancellationTokenSource.token;
  const token = new MergedToken([clientToken, serverToken]);

  if (params.contextItems) {
    setContextItems(ctx, params.contextItems);
  }

  let textDocument = await getOpenTextDocumentChecked(ctx, params.textDocument, token);
  const completionInfo = params.context.selectedCompletionInfo;
  let position = params.position;

  if (completionInfo) {
    ({ position, textDocument } = positionAndContentForCompleting(telemetryData, textDocument, completionInfo));
  }

  const resultWithTelemetry = await getGhostText(
    ctx,
    textDocument,
    position,
    telemetryData,
    token,
    { isCycling, ifInserted: completionInfo, promptOnly: true },
    params.data
  );
  if (resultWithTelemetry.type !== 'promptOnly') {
    throw new Error(`Unexpected result type ${resultWithTelemetry.type}`);
  }
  return [{ prompt: resultWithTelemetry.prompt }, null];
}
const type = CopilotInlineCompletionPromptRequest.type;
const handle = addMethodHandlerValidation(CopilotInlineCompletionWithContextItemsSchema, (ctx, token, params) =>
  handleChecked(ctx, token, params)
);

export { handle, type };
