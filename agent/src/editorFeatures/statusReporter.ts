import { Context } from '../../../lib/src/context.ts';
import { Service } from '../service.ts';
import { StatusReporter } from '../../../lib/src/progress.ts';
import { StatusNotificationNotification } from '../../../types/src/index.ts';

class NotificationStatusReporter extends StatusReporter {
  status = 'Normal';

  constructor(readonly ctx: Context) {
    super();
  }

  setProgress(): void {
    if (this.status === 'Error') return;
    this.status = 'InProgress';
    const notification = { status: 'InProgress', message: '' };
    this.ctx.get(Service).connection.sendNotification(StatusNotificationNotification.type, notification);
  }

  removeProgress(): void {
    if (this.status === 'Error' || this.status === 'Warning') return;
    this.status = 'Normal';
    const notification = { status: 'Normal', message: '' };
    this.ctx.get(Service).connection.sendNotification(StatusNotificationNotification.type, notification);
  }

  forceNormal(): void {
    this.status = 'Normal';
    const notification = { status: 'Normal', message: '' };
    this.ctx.get(Service).connection.sendNotification(StatusNotificationNotification.type, notification);
  }

  setInactive(message?: string): void {
    this.status = 'Inactive';
    const notification = { status: 'Inactive', message: message ?? '' };
    this.ctx.get(Service).connection.sendNotification(StatusNotificationNotification.type, notification);
  }

  setWarning(warningMessage?: string): void {
    if (this.status === 'Error') return;
    this.status = 'Warning';
    const notification = { status: 'Warning', message: warningMessage ?? '' };
    this.ctx.get(Service).connection.sendNotification(StatusNotificationNotification.type, notification);
  }

  setError(errorMessage: string): void {
    this.status = 'Error';
    const notification = { status: 'Error', message: errorMessage };
    this.ctx.get(Service).connection.sendNotification(StatusNotificationNotification.type, notification);
  }
}

export { NotificationStatusReporter };
