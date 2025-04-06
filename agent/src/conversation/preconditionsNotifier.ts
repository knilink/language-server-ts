import { NotificationType } from 'vscode-languageserver';
import { Context } from '../../../lib/src/context.ts';
import { PreconditionsCheck, type PreconditionsResultEvent } from '../../../lib/src/conversation/preconditions.ts';
import { Service } from '../service.ts';

export class PreconditionsNotifier {
  readonly notificationEndpoint = 'conversation/preconditionsNotification';

  constructor(readonly ctx: Context) {
    this.ctx.get(PreconditionsCheck).onChange((event: PreconditionsResultEvent) => {
      this.sendNotification(event);
    });
  }

  async sendNotification(result: PreconditionsResultEvent): Promise<void> {
    return this.ctx.get(Service).connection.sendNotification(new NotificationType(this.notificationEndpoint), result);
  }
}
