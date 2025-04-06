import { LogLevel } from '../../../lib/src/logger.ts';
import type { Context } from '../../../lib/src/context.ts';

import { ConnectionError, MessageType, NotificationType } from '../../../node_modules/vscode-languageserver/node.js';
import { Service } from '../service.ts';
import { LogTarget } from '../../../lib/src/logger.ts';
import { formatLogMessage, verboseLogging } from '../../../lib/src/logging/util.ts';

const LogLevelMessageType = new Map<LogLevel, MessageType>([
  [LogLevel.DEBUG, MessageType.Log],
  [LogLevel.INFO, MessageType.Info],
  [LogLevel.WARN, MessageType.Warning],
  [LogLevel.ERROR, MessageType.Error],
]);

class NotificationLogger extends LogTarget {
  logIt(ctx: Context, level: LogLevel, category: string, ...extra: unknown[]) {
    if (level == LogLevel.DEBUG && !verboseLogging(ctx) && category !== 'console') {
      return;
    }
    const notification = { type: LogLevelMessageType.get(level), message: formatLogMessage(category, ...extra) };

    const sender = ctx.get(Service).connection;
    try {
      sender.sendNotification(new NotificationType('window/logMessage'), notification);
    } catch (e) {
      if (e instanceof ConnectionError) return;
      throw e;
    }
  }
}

export { NotificationLogger };
