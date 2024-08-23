import { Type, type Static } from '@sinclair/typebox';

export const RangeSchema = Type.Object({
  start: Type.Object({ line: Type.Number({ minimum: 0 }), character: Type.Number({ minimum: 0 }) }),
  end: Type.Object({ line: Type.Number({ minimum: 0 }), character: Type.Number({ minimum: 0 }) }),
});

export const DocumentSchema = Type.Object({
  uri: Type.String(),
  position: Type.Optional(Type.Object({ line: Type.Number({ minimum: 0 }), character: Type.Number({ minimum: 0 }) })),
  visibleRange: Type.Optional(RangeSchema),
  selection: Type.Optional(RangeSchema),
  openedAt: Type.Optional(Type.String()),
  activeAt: Type.Optional(Type.String()),
});

export const FileReferenceSchema = DocumentSchema;

export const ReferenceSchema = Type.Union([FileReferenceSchema]);
export type Reference = Static<typeof ReferenceSchema>;

export const ConversationSourceSchema = Type.Union([Type.Literal('panel'), Type.Literal('inline')]);
