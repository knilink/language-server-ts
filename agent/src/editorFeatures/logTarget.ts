import { MessageType, NotificationType, ConnectionError } from 'vscode-languageserver/node';

import { Context } from '../../../lib/src/context';
import { format, verboseLogging, LogLevel, LogTarget } from '../../../lib/src/logger';
import { Service } from '../service';

const LogLevelMessageType = new Map<LogLevel, MessageType>([
  [LogLevel.DEBUG, MessageType.Log],
  [LogLevel.INFO, MessageType.Info],
  [LogLevel.WARN, MessageType.Warning],
  [LogLevel.ERROR, MessageType.Error],
]);

class NotificationLogger extends LogTarget {
  logIt(ctx: Context, level: LogLevel, metadataStr: string, ...extra: unknown[]) {
    const notification = {
      type: LogLevelMessageType.get(level),
      message: [metadataStr, format(extra)].join(' '),
    };

    const sender = ctx.get(Service).connection;
    try {
      sender.sendNotification(new NotificationType('window/logMessage'), notification);
    } catch (e) {
      if (e instanceof ConnectionError) return;
      throw e;
    }
  }

  shouldLog(ctx: Context, level: number): boolean {
    return verboseLogging(ctx) || level < LogLevel.DEBUG;
  }
}

export { NotificationLogger };
