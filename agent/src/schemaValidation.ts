import { type TSchema, type Static } from '@sinclair/typebox';
import { TypeCompiler, ValueError, ValueErrorIterator } from '@sinclair/typebox/compiler';
import { type CancellationToken } from 'vscode-languageserver';

import { Context } from '../../lib/src/context.ts';
import { ErrorCode } from './rpc.ts';
type ValidationError = { code: number; message: string };

type HandlerFunction<T extends TSchema = TSchema, R = unknown, P extends Static<T> = unknown> = (
  ctx: Context,
  token: CancellationToken,
  params: P
) => Promise<['OK' | R, null] | [null, ValidationError]>;

function addMethodHandlerValidation<T extends TSchema, R>(
  schema: T,
  // ./methods/snippy.ts signal:
  handleFn: (
    ctx: Context,
    token: CancellationToken,
    params: Static<T>
  ) => Promise<['OK' | R, null] | [null, ValidationError]>
): HandlerFunction<T, R> {
  const typeCheck = TypeCompiler.Compile(schema);
  return async (
    ctx: Context,
    token: CancellationToken,
    params: Static<T>
  ): Promise<['OK' | R, null] | [null, ValidationError]> => {
    if (!typeCheck.Check(params)) {
      const message = createErrorMessage(typeCheck.Errors(params));
      return [null, { code: ErrorCode.InvalidParams, message }];
    }
    return handleFn(ctx, token, params);
  };
}

function createErrorMessage(errors: ValueErrorIterator): string {
  const messages = Array.from<ValueError>(errors)
    .map((e) => `- ${e.path}: ${e.message}`)
    .join(`\n`);
  return `Schema validation failed with the following errors:
${messages}`;
}

class SchemaValidationError extends Error {
  constructor(schemaErrors: ValueErrorIterator) {
    super(createErrorMessage(schemaErrors));
  }
}

export { addMethodHandlerValidation, SchemaValidationError, ValidationError, HandlerFunction };
