import { type TSchema } from '@sinclair/typebox';
import { TypeCompiler, TypeCheck } from '@sinclair/typebox/compiler';
import { type Connection, ExecuteCommandParams } from 'vscode-languageserver/node.js';

import { type CancellationToken } from '../cancellation.ts';
import { Context } from '../../../lib/src/context.ts';
import { purgeNulls } from '../service.ts';
import { SchemaValidationError } from '../schemaValidation.ts';

import { completionCommands } from './completion.ts';
import { panelCommands } from './panel.ts';
import { type AbstractCommand } from './abstract.ts';

export function registerCommands(ctx: Context, connection: Connection) {
  const lookup = new Map<string, { typeCheck: TypeCheck<TSchema>; command: AbstractCommand }>();
  for (const commandClass of commands) {
    const commandInstance = new commandClass(ctx);
    const typeCheck = TypeCompiler.Compile(commandInstance.arguments);
    lookup.set(commandInstance.name, { typeCheck, command: commandInstance });
  }

  connection.onExecuteCommand(async (params: ExecuteCommandParams, token: CancellationToken) => {
    const handler = lookup.get(params.command);
    if (!handler) throw new Error(`Unknown command: ${params.command}`);

    const args = purgeNulls(params.arguments ?? []);
    if (args.length < handler.command.arguments.minItems) {
      args.length = handler.command.arguments.minItems;
    }
    if (handler.typeCheck.Check(params.arguments)) {
      return handler.command.handle(token, args);
    }
    throw new SchemaValidationError(handler.typeCheck.Errors(params.arguments));
  });

  return [...lookup.keys()];
}

const commands: (new (ctx: Context) => AbstractCommand)[] = [...completionCommands, ...panelCommands];
