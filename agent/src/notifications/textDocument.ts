import {
  DidPartiallyAcceptCompletionNotification,
  DidPartiallyAcceptCompletionParams,
  DidPartiallyAcceptCompletionParamsType,
  DidShowCompletionNotification,
  DidShowCompletionParams,
  DidShowCompletionParamsType,
} from '../../../types/src/index.ts';

import { AbstractNotification } from './abstract.ts';

import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import {
  handleGhostTextShown,
  handleGhostTextPostInsert,
  handlePartialGhostTextPostInsert,
} from '../../../lib/src/ghostText/last.ts';

class DidShowCompletionNotificationHandler extends AbstractNotification {
  readonly name = DidShowCompletionNotification.method;
  readonly params = DidShowCompletionParams;

  async handle(params: DidShowCompletionParamsType) {
    const id = params.item.command.arguments[0];
    const completion = this.ctx.get(CopilotCompletionCache).get(id);
    if (completion) {
      handleGhostTextShown(this.ctx, completion);
    }
  }
}

class DidPartiallyAcceptCompletionNotificationHandler extends AbstractNotification {
  readonly name = DidPartiallyAcceptCompletionNotification.method;
  readonly params = DidPartiallyAcceptCompletionParams;

  async handle(params: DidPartiallyAcceptCompletionParamsType) {
    const id = params.item.command.arguments[0];
    const length = params.acceptedLength;
    const cache = this.ctx.get(CopilotCompletionCache);
    const completion = cache.get(id);

    if (completion) {
      cache.delete(id);
      if (length >= completion.insertText.length) {
        handleGhostTextPostInsert(this.ctx, completion);
      } else {
        handlePartialGhostTextPostInsert(this.ctx, completion, length);
      }
    }
  }
}

const textDocumentNotifications: AbstractNotification.Ctor[] = [
  DidShowCompletionNotificationHandler,
  DidPartiallyAcceptCompletionNotificationHandler,
];

export { textDocumentNotifications };
