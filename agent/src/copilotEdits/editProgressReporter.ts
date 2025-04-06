import type { Context } from '../../../lib/src/context.ts';
import type { TurnContext } from '../../../lib/src/conversation/turnContext.ts';

import * as lsp from 'vscode-languageserver-protocol';
import { Service } from '../service.ts';
import { EditProgressReporter } from '../../../lib/src/copilotEdits/progress/editProgressReporter.ts';

class AgentEditProgressReporter extends EditProgressReporter {
  constructor(readonly ctx: Context) {
    super(ctx);
  }
  async report(partialResultToken: string | number, resultItem: object) {
    await this.ctx.get(Service).connection.sendProgress(new lsp.ProgressType(), partialResultToken, [resultItem]);
  }
  async reportTurn(
    turnCtx: { editConversationId: string; editTurnId: string; partialResultToken: string | number },
    resultItems: object
  ) {
    await this.ctx
      .get(Service)
      .connection.sendProgress(new lsp.ProgressType(), turnCtx.partialResultToken, [
        { editConversationId: turnCtx.editConversationId, editTurnId: turnCtx.editTurnId, ...resultItems },
      ]);
  }
}

export { AgentEditProgressReporter };
