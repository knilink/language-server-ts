import { type Static, type TSchema } from '@sinclair/typebox';
import { type CancellationToken } from "../cancellation.ts";
import { type Context } from "../../../lib/src/context.ts";

abstract class AbstractCommand {
  abstract readonly name: string;
  abstract readonly arguments: TSchema;
  constructor(readonly ctx: Context) { }
  abstract handle(token: CancellationToken, args: Static<TSchema>): Promise<boolean>;
}

export { AbstractCommand };
