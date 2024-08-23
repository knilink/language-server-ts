import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../cancellation';
import { type Completion } from '../../../lib/src/types';
import { type SuggestionStatus } from '../../../lib/src/suggestions/partialSuggestions';

import { Context } from '../../../lib/src/context';
import { CopilotCompletionCache } from '../copilotCompletionCache';
import { postInsertionTasks } from '../../../lib/src/postInsertion';
import { TestingOptions } from './testingOptions';
import { addMethodHandlerValidation } from '../schemaValidation';

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
