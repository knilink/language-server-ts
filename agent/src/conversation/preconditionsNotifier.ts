import { NotificationType } from 'vscode-languageserver';
import { Context } from '../../../lib/src/context.ts';
import { PreconditionsCheck, type PreconditionsResultEvent } from '../../../lib/src/conversation/preconditions.ts';
import { Service } from '../service.ts';

export class PreconditionsNotifier {
  readonly notificationType = new NotificationType<PreconditionsResultEvent>('conversation/preconditionsNotification');

  constructor(readonly ctx: Context) {
    this.ctx.get(PreconditionsCheck).onChange((event: PreconditionsResultEvent) => {
      this.sendNotification(event);
    });
  }

  private sendNotification(result: PreconditionsResultEvent): void {
    this.ctx.get(Service).connection.sendNotification(this.notificationType, result);
  }
}
