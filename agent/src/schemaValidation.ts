import { type TSchema, type Static } from '@sinclair/typebox';
import { TypeCompiler, ValueError, ValueErrorIterator } from '@sinclair/typebox/compiler';

import { Context } from '../../lib/src/context.ts';
import { CancellationToken } from './cancellation.ts';
// import { } from './rpc';

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
      return [null, { code: -32602, message }];
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

// import { Type } from '@sinclair/typebox';
// const Params = Type.Object({
//   authType: Type.Union([Type.Literal('editorAuth'), Type.Literal('deviceFlow')]),
// });
// export const aasdfasf: (params: Static<TSchema>) => void = (params: Static<typeof Params>) => { };
