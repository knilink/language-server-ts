import { Type } from '@sinclair/typebox';

import { CancellationToken } from '../cancellation';
import { Context } from '../../../lib/src/context';
import { WorkDoneProgressTokens } from '../workDoneProgressTokens';
import { AbstractNotification } from './abstract';

class WorkDoneProgressCancelNotification extends AbstractNotification {
  public name = 'window/workDoneProgress/cancel';
  public params = Type.Object({ token: Type.Union([Type.String(), Type.Number()]) });

  constructor(ctx: Context) {
    super(ctx);
  }

  handle(params: { token: CancellationToken }) {
    const ctx = this.ctx;
    ctx.get(WorkDoneProgressTokens).cancel(params.token);
  }
}

export { WorkDoneProgressCancelNotification };
