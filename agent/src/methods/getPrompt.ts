import { type Static } from '@sinclair/typebox';
import { Params, cancellationReason, fetchGhostText } from './getCompletions.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { CancellationToken } from '../cancellation.ts';
import { Context } from '../../../lib/src/context.ts';
import { ExtractedPrompt } from '../../../lib/src/prompt/prompt.ts';

async function handleGetPromptHelper(
  ctx: Context,
  clientToken: CancellationToken,
  params: Static<typeof Params>
): Promise<
  [{ prompt: ExtractedPrompt } | { cancellationReason: string } | {}, null] | [null, { code: number; message: string }]
> {
  let ghostTextFetchResult = await fetchGhostText(ctx, clientToken, params, false, true);
  if (ghostTextFetchResult.type === 'earlyFailure') return ghostTextFetchResult.result;
  if (ghostTextFetchResult.type === 'earlyCancellation')
    return [{ cancellationReason: ghostTextFetchResult.result[0].cancellationReason }, null];
  if (ghostTextFetchResult.type === 'earlySuccess') return [{}, null];
  let resultWithTelemetry = ghostTextFetchResult.resultWithTelemetry;
  return resultWithTelemetry.type === 'promptOnly'
    ? [{ prompt: resultWithTelemetry.prompt }, null]
    : [{ ...cancellationReason(resultWithTelemetry) }, null];
}

const handleGetPrompt = addMethodHandlerValidation(Params, (ctx, token, params) =>
  handleGetPromptHelper(ctx, token, params)
);

export { handleGetPrompt };
