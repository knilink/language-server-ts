import { Type, type Static } from '@sinclair/typebox';

import { AbstractNotification } from './abstract.ts';

import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import {
  handleGhostTextShown,
  handleGhostTextPostInsert,
  handlePartialGhostTextPostInsert,
} from '../../../lib/src/ghostText/last.ts';

const ItemParam = Type.Object({
  command: Type.Object({ arguments: Type.Tuple([Type.String({ minLength: 1 })]) }),
});

class DidShowCompletionNotification extends AbstractNotification {
  readonly name = 'textDocument/didShowCompletion';
  readonly params = Type.Object({ item: ItemParam });

  async handle(params: Static<DidShowCompletionNotification['params']>) {
    const id = params.item.command.arguments[0];
    const completion = this.ctx.get(CopilotCompletionCache).get(id);
    if (completion) {
      handleGhostTextShown(this.ctx, completion);
    }
  }
}

class DidPartiallyAcceptCompletionNotification extends AbstractNotification {
  readonly name = 'textDocument/didPartiallyAcceptCompletion';
  readonly params = Type.Object({ item: ItemParam, acceptedLength: Type.Number({ minimum: 1 }) });

  async handle(params: Static<DidPartiallyAcceptCompletionNotification['params']>) {
    const id = params.item.command.arguments[0];
    const length = params.acceptedLength;
    const cache = this.ctx.get(CopilotCompletionCache);
    const completion = cache.get(id);

    if (completion) {
      cache.delete(id);
      if (length >= completion.insertText.length) {
        await handleGhostTextPostInsert(this.ctx, completion);
      } else {
        await handlePartialGhostTextPostInsert(this.ctx, completion, length);
      }
    }
  }
}

const textDocumentNotifications = [DidShowCompletionNotification, DidPartiallyAcceptCompletionNotification];

export { textDocumentNotifications };
