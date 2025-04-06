import type { Connection } from 'vscode-languageserver/node.js';
import type { Context } from '../../../lib/src/context.ts';
import type { AbstractNotification } from './abstract.ts';

import { githubNotifications } from './github.ts';
import { textDocumentNotifications } from './textDocument.ts';
import { WorkDoneProgressCancelNotification } from './workDoneProgressCancel.ts';
import { SchemaValidationError } from '../schemaValidation.ts';
import { logger, purgeNulls } from '../service.ts';
import { telemetryCatch } from '../../../lib/src/telemetry.ts';
import { TypeCompiler } from '@sinclair/typebox/compiler';

function registerNotifications(ctx: Context, connection: Connection): void {
  for (const notificationClass of notifications) {
    const notification = new notificationClass(ctx);
    const typeCheck = TypeCompiler.Compile(notification.params);
    connection.onNotification(
      notification.type,
      telemetryCatch(
        ctx,
        async (p) => {
          purgeNulls(p);

          if (typeCheck.Check(p)) {
            // MARK => void
            await notification.handle(p);
          } else {
            logger.error(ctx, `Notification ${notification.name}:`, new SchemaValidationError(typeCheck.Errors(p)));
          }
        },
        `Notification ${notification.name}`
      )
    );
  }
}

const notifications: AbstractNotification.Ctor[] = [
  ...githubNotifications,
  ...textDocumentNotifications,
  WorkDoneProgressCancelNotification,
];

export { registerNotifications };
