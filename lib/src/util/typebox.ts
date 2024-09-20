import { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export function assertShape<T extends TSchema>(schema: T, payload: unknown) {
  if (Value.Check(schema, payload)) return payload;
  let error = `Typebox schema validation failed:\n${[...Value.Errors(schema, payload)].map((i) => `${i.path} ${i.message}`).join(`\n  `)}`;
  throw new Error(error);
}
