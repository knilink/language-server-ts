import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Connection } from 'vscode-languageserver/node';

import { type Context } from '../../../lib/src/context';
import { purgeNulls, logger } from '../service';
import { SchemaValidationError } from '../schemaValidation';

import { } from '../schemaValidation';
import { WorkDoneProgressCancelNotification } from './workDoneProgressCancel';
import { githubNotifications } from './github';
import { } from '../service';
import { textDocumentNotifications } from './textDocument';
import { type AbstractNotification } from './abstract';

function registerNotifications(ctx: Context, connection: Connection): void {
  for (const notificationClass of notifications) {
    const notification = new notificationClass(ctx);
    const typeCheck = TypeCompiler.Compile(notification.params);
    connection.onNotification(notification.type, async (p: unknown) => {
      purgeNulls(p);
      if (typeCheck.Check(p)) {
        await notification.handle(p);
      } else {
        logger.error(ctx, `Notification ${notification.name}:`, new SchemaValidationError(typeCheck.Errors(p)));
      }
    });
  }
}

const notifications: (new (ctx: Context) => AbstractNotification)[] = [
  ...githubNotifications,
  ...textDocumentNotifications,
  WorkDoneProgressCancelNotification,
];

export { registerNotifications };
