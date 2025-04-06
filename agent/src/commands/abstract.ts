import type { Static, TSchema } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../lib/src/context.ts';
import type { AuthStatus } from '../../../lib/src/auth/types.ts';

abstract class AbstractCommand {
  abstract readonly name: string;
  abstract readonly arguments: TSchema;
  constructor(readonly ctx: Context) {}
  abstract handle(token: CancellationToken, args: Static<TSchema>): Promise<unknown>;
}

export { AbstractCommand };
