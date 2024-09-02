import { MessageActionItem } from 'vscode-languageserver/node.js';

import { Context } from '../../lib/src/context.ts';
import { Service } from './service.ts';

import { NotificationSender } from '../../lib/src/notificationSender.ts';

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
