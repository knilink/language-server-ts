import type { StatusEvent } from '../../../lib/src/progress.ts';

import { Context } from '../../../lib/src/context.ts';
import { Service } from '../service.ts';
import { StatusReporter } from '../../../lib/src/progress.ts';
import { StatusNotificationNotification } from '../../../types/src/index.ts';

class NotificationStatusReporter extends StatusReporter {
  constructor(readonly ctx: Context) {
    super();
  }

  didChange(event: StatusEvent) {
    let status = event.kind;

    if (event.busy && status !== 'Error') {
      status = 'InProgress';
    }

    this.ctx.get(Service).connection.sendNotification(StatusNotificationNotification.type, {
      busy: event.busy,
      kind: event.kind,
      status,
      message: event.message ?? '',
    });

    this.ctx
      .get(Service)
      .connection.sendNotification('didChangeStatus', { busy: event.busy, kind: event.kind, message: event.message });
  }
}

export { NotificationStatusReporter };
