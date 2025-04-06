import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Type } from '@sinclair/typebox';
import { CopilotInlineCompletionSchema } from '../../../../types/src/inlineCompletion.ts';
import type { TSchema, Static } from '@sinclair/typebox';
import type {} from '../../../../types/src/index.ts';

type ContextItemResolution = 'none' | 'full' | 'partial' | 'error';

interface ContextItem<T = unknown> {
  // ../contextProviderRegistry.ts
  id?: string; // MARK ???
  // ./codeSnippets.ts
  providerId: string;
  // ./codeSnippets.ts
  matchScore: number;

  // ./codeSnippets.ts
  // ../contextProviderRegistry.ts
  resolution: ContextItemResolution;
  // ../contextProviderRegistry.ts
  resolutionTimeMs?: number;
  data: T[];
}

function getFilteredDataFromContextItem<T extends TSchema>(contextItem: ContextItem, schema: T): Static<T>[] {
  const validator = TypeCompiler.Compile(schema);
  return contextItem.data.filter((data) => validator.Check(data));
}

function filterContextItemsBySchema<T extends TSchema>(
  contextItems: ContextItem[],
  schema: T
): ContextItem<Static<T>>[] {
  return contextItems
    .map((contextItem) => {
      const data = getFilteredDataFromContextItem(contextItem, schema);
      if (data.length !== 0) {
        return { ...contextItem, data };
      }
    })
    .filter((i) => i !== undefined);
}

const ContextItemSchema = Type.Object({
  importance: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  id: Type.Optional(Type.String()),
});

const TraitSchema = Type.Intersect([Type.Object({ name: Type.String(), value: Type.String() }), ContextItemSchema]);
type TraitType = Static<typeof TraitSchema>;

const CodeSnippetSchema = Type.Intersect([
  Type.Object({ uri: Type.String(), value: Type.String(), additionalUris: Type.Optional(Type.Array(Type.String())) }),
  ContextItemSchema,
]);
type CodeSnippetType = Static<typeof CodeSnippetSchema>;

const SupportedContextItemSchema = [TraitSchema, CodeSnippetSchema];
const SupportedContextItemSchemaUnion = Type.Union(SupportedContextItemSchema);
// const ensureTypesAreEqual = (x: unknown) => x;
// ensureTypesAreEqual(true);
const TraitWithIdSchema = Type.Intersect([TraitSchema, Type.Object({ id: Type.String() })]);
type TraitWithIdType = Static<typeof TraitWithIdSchema>;
const CodeSnippetWithIdSchema = Type.Intersect([CodeSnippetSchema, Type.Object({ id: Type.String() })]);
const SupportedContextItemWithIdSchema = [TraitWithIdSchema, CodeSnippetWithIdSchema];
const SupportedContextItemWithIdSchemaUnion = Type.Union(SupportedContextItemWithIdSchema);
const ContextProviderSupportedContext = Type.Object({ contextItems: Type.Array(SupportedContextItemSchemaUnion) });
type SupportedContextItemTypeUnion = Static<typeof SupportedContextItemSchemaUnion>;
const ContextProviderSelectorPartialSchema = Type.Object({
  selector: Type.Array(
    Type.Union([
      Type.String(),
      Type.Object({
        language: Type.Optional(Type.String()),
        scheme: Type.Optional(Type.String()),
        pattern: Type.Optional(Type.String()),
      }),
    ])
  ),
});
const BaseContextProviderSchema = Type.Object({ id: Type.String() });
const RegistrationContextProviderSchema = Type.Intersect([
  BaseContextProviderSchema,
  ContextProviderSelectorPartialSchema,
]);
type RegistrationContextProviderType = Static<typeof RegistrationContextProviderSchema>;
const CompletionContextProviderSchema = Type.Intersect([BaseContextProviderSchema, ContextProviderSupportedContext]);
const ContextProviderRegistrationSchema = Type.Object({ providers: Type.Array(RegistrationContextProviderSchema) });
type ContextProviderRegistrationType = Static<typeof ContextProviderRegistrationSchema>;
const ContextProviderUnregisterSchema = Type.Object({ providers: Type.Array(BaseContextProviderSchema) });
const LspContextItemSchema = Type.Object({
  providers: Type.Array(CompletionContextProviderSchema),
  updating: Type.Optional(Type.Array(Type.String())),
});
type LspContextItemType = Static<typeof LspContextItemSchema>;
const CopilotInlineCompletionWithContextItemsSchema = Type.Intersect([
  CopilotInlineCompletionSchema,
  Type.Object({ contextItems: Type.Optional(LspContextItemSchema) }),
]);
type CopilotInlineCompletionWithContextItemsType = Static<typeof CopilotInlineCompletionWithContextItemsSchema>;

export {
  CodeSnippetWithIdSchema,
  ContextProviderRegistrationSchema,
  ContextProviderUnregisterSchema,
  CopilotInlineCompletionWithContextItemsSchema,
  LspContextItemSchema,
  TraitWithIdSchema,
  filterContextItemsBySchema,
};

export type {
  ContextItem,
  CodeSnippetType,
  RegistrationContextProviderType,
  ContextItemResolution,
  TraitType,
  TraitWithIdType,
  SupportedContextItemTypeUnion,
  LspContextItemType,
  CopilotInlineCompletionWithContextItemsType,
  ContextProviderRegistrationType,
};
