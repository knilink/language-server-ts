import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Connection } from "vscode-languageserver/node.js";

import { type Context } from '../../../lib/src/context.ts';
import { purgeNulls, logger } from '../service.ts';
import { SchemaValidationError } from '../schemaValidation.ts';

import { } from '../schemaValidation.ts';
import { WorkDoneProgressCancelNotification } from './workDoneProgressCancel.ts';
import { githubNotifications } from './github.ts';
import { } from '../service.ts';
import { textDocumentNotifications } from './textDocument.ts';
import { type AbstractNotification } from './abstract.ts';

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
