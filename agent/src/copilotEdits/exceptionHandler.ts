import type { Context } from '../../../lib/src/context.ts';
import type { EditTurnContext } from '../../../lib/src/copilotEdits/resources/editTurnContext.ts';

import { ErrorCode } from '../rpc.ts';
import { CopilotEditsCancelledByUserException } from '../../../lib/src/copilotEdits/exceptions/cancelledByUserException.ts';

class CopilotEditsExceptionHandler {
  constructor(readonly ctx: Context) {}
  handleException(
    ctx: Context,
    error: unknown,
    editTurnCtx: EditTurnContext
  ): [null, { code: number; message: string }] {
    return error instanceof CopilotEditsCancelledByUserException
      ? [null, { code: ErrorCode.RequestCancelled, message: 'Request cancelled by user' }]
      : [
          null,
          {
            code: ErrorCode.InternalError,
            message: error instanceof Error ? error.message : 'An unknown error occurred',
          },
        ];
  }
}

export { CopilotEditsExceptionHandler };
