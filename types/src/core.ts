import {} from 'vscode-languageserver-protocol';
import { Type, type Static } from '@sinclair/typebox';

const DocumentUriSchema = Type.String();
const TextDocumentIdentifierSchema = Type.Object({ uri: DocumentUriSchema });
const OptionalVersionedTextDocumentIdentifierSchema = Type.Intersect([
  TextDocumentIdentifierSchema,
  Type.Object({ version: Type.Optional(Type.Integer()) }),
]);
const VersionedTextDocumentIdentifierSchema = Type.Required(OptionalVersionedTextDocumentIdentifierSchema);
const PositionSchema = Type.Object({ line: Type.Integer({ minimum: 0 }), character: Type.Integer({ minimum: 0 }) });
const RangeSchema = Type.Object({ start: PositionSchema, end: PositionSchema });
const ProgressTokenSchema = Type.Union([Type.Integer(), Type.String()]);

export {
  DocumentUriSchema,
  OptionalVersionedTextDocumentIdentifierSchema,
  PositionSchema,
  ProgressTokenSchema,
  RangeSchema,
};
