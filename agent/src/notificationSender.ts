import { MessageActionItem } from 'vscode-languageserver/node';

import { Context } from '../../lib/src/context';
import { Service } from './service';

import { NotificationSender } from '../../lib/src/notificationSender';

class ConnectionNotificationSender extends NotificationSender {
  constructor(readonly ctx: Context) {
    super();
  }

  get connection() {
    return this.ctx.get(Service).connection;
  }

  showWarningMessage<T extends MessageActionItem>(message: string, ...actions: T[]): Promise<T | undefined> {
    return this.connection.window.showWarningMessage(message, ...actions);
  }
}

export { ConnectionNotificationSender };
