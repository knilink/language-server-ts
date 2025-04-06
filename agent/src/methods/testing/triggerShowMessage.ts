import type { Static } from '@sinclair/typebox';
import type { Context } from '../../../../lib/src/context.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';

import { NotificationSender } from '../../../../lib/src/notificationSender.ts';
import { LogTarget, LogLevel } from '../../../../lib/src/logger.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({});

async function handleTriggerShowMessageChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  const sender = ctx.get(NotificationSender);
  const logger = ctx.get(LogTarget);
  try {
    const r = await sender.showWarningMessage('This is a test message', { title: 'Some Action' });
    sendNotification(LogLevel.INFO, 'response from message request', r?.title);
  } catch (error) {
    sendNotification(LogLevel.ERROR, 'error sending show message request', error);
  }

  async function sendNotification(level: LogLevel, message: string, payload?: unknown): Promise<void> {
    return logger.logIt(ctx, level, 'triggerShowMessage', `${message} (${String(payload)})`);
  }
  return ['OK', null];
}

const handleTriggerShowMessage = addMethodHandlerValidation(Params, handleTriggerShowMessageChecked);

export { handleTriggerShowMessage };
