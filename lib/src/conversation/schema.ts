import { Type, type Static } from '@sinclair/typebox';
import { RangeSchema } from '../../../types/src/index.ts';
import { WebSearchReferenceSchema } from './extensibility/references.ts';

const FileStatusSchema = Type.Union([
  Type.Literal('included'),
  Type.Literal('blocked'),
  Type.Literal('notfound'),
  Type.Literal('empty'),
]);

const DocumentSchema = Type.Object({
  uri: Type.String(),
  position: Type.Optional(Type.Object({ line: Type.Number({ minimum: 0 }), character: Type.Number({ minimum: 0 }) })),
  visibleRange: Type.Optional(RangeSchema),
  selection: Type.Optional(RangeSchema),
  openedAt: Type.Optional(Type.String()),
  activeAt: Type.Optional(Type.String()),
});

const FileReferenceSchema = Type.Intersect([
  Type.Object({
    type: Type.Literal('file'),
    status: Type.Optional(FileStatusSchema),
    range: Type.Optional(RangeSchema),
  }),
  DocumentSchema,
]);
type FileReference = Static<typeof FileReferenceSchema>;

const ReferenceSchema = Type.Union([FileReferenceSchema, WebSearchReferenceSchema]);

type Reference = Static<typeof ReferenceSchema>;

const ConversationSourceSchema = Type.Union([Type.Literal('panel'), Type.Literal('inline')]);

export { ConversationSourceSchema, DocumentSchema, ReferenceSchema, FileReference, Reference };
