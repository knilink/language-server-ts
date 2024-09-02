import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../cancellation.ts';
import { type Completion } from '../../../lib/src/types.ts';
import { type SuggestionStatus } from '../../../lib/src/suggestions/partialSuggestions.ts';

import { Context } from '../../../lib/src/context.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { postInsertionTasks } from '../../../lib/src/postInsertion.ts';
import { TestingOptions } from './testingOptions.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';

const Params = Type.Object({
  uuid: Type.String({ minLength: 1 }),
  acceptedLength: Type.Optional(Type.Number({ minimum: 1 })),
  options: Type.Optional(TestingOptions),
});

async function notifyAcceptedChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  const cache = ctx.get<CopilotCompletionCache>(CopilotCompletionCache);
  const completion = cache.get(params.uuid);

  if (completion) {
    cache.delete(params.uuid);

    const suggestionStatus = getSuggestionStatus(params, completion);

    postInsertionTasks(
      ctx,
      completion.triggerCategory,
      completion.insertText,
      completion.offset,
      completion.file,
      completion.telemetry,
      suggestionStatus,
      completion.uuid,
      completion.range.start
    );
  }

  return ['OK', null];
}

function getSuggestionStatus(params: Static<typeof Params>, completion: Completion): SuggestionStatus {
  if (typeof params.acceptedLength === 'undefined') {
    return { compType: 'full' };
  } else if (params.acceptedLength! < completion.insertText.length) {
    return { compType: 'partial', acceptedLength: params.acceptedLength };
  } else {
    return { compType: 'full' };
  }
}

const notifyAccepted = addMethodHandlerValidation(Params, notifyAcceptedChecked);

export { notifyAccepted };
