import { Type } from '@sinclair/typebox';

import { Context } from '../../../lib/src/context.ts';
import { WorkDoneProgressTokens } from '../workDoneProgressTokens.ts';
import { AbstractNotification } from './abstract.ts';

class WorkDoneProgressCancelNotification extends AbstractNotification {
  public name = 'window/workDoneProgress/cancel';
  public params = Type.Object({ token: Type.Union([Type.String(), Type.Number()]) });

  constructor(ctx: Context) {
    super(ctx);
  }

  handle(params: { token: number | string }) {
    const ctx = this.ctx;
    ctx.get(WorkDoneProgressTokens).cancel(params.token);
  }
}

export { WorkDoneProgressCancelNotification };
