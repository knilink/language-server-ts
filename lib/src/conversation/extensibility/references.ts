import { Type, type Static } from '@sinclair/typebox';
import { Reference } from '../schema.ts';

const WebSearchReferenceSchema = Type.Object({
  type: Type.Literal('github.web-search'),
  id: Type.String(),
  data: Type.Object({
    query: Type.String(),
    type: Type.String(),
    results: Type.Optional(
      Type.Array(Type.Object({ title: Type.String(), excerpt: Type.String(), url: Type.String() }))
    ),
  }),
  metadata: Type.Optional(
    Type.Object({ display_name: Type.Optional(Type.String()), display_icon: Type.Optional(Type.String()) })
  ),
});

type WebSearchReference = Static<typeof WebSearchReferenceSchema>;

function filterUnsupportedReferences(references?: Reference[]): WebSearchReference[] {
  return references?.filter((r) => r.type === 'github.web-search').map((r) => r) ?? [];
}
function convertToCopilotReferences(references?: Reference[]): WebSearchReference[] {
  return references?.filter((r) => r.type === 'github.web-search').map((r) => r) ?? [];
}

export { WebSearchReferenceSchema, WebSearchReference, convertToCopilotReferences, filterUnsupportedReferences };
