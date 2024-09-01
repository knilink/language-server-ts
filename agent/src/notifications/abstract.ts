import { TSchema } from '@sinclair/typebox';
import { Context } from "../../../lib/src/context.ts";
import { NotificationType } from 'vscode-languageserver';

abstract class AbstractNotification {
  abstract name: string;
  abstract params: TSchema;
  abstract handle(params: unknown): void;

  constructor(readonly ctx: Context) { }

  get type() {
    return new NotificationType(this.constructor.name);
  }

  handler(params: unknown): void {
    this.handle(params);
  }
}

export { AbstractNotification };
