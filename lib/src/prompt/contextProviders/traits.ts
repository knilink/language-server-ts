import type { Context } from '../../context.ts';
import type { ContextItem, TraitType, TraitWithIdType } from './contextItemSchemas.ts';

import { TraitWithIdSchema, filterContextItemsBySchema } from './contextItemSchemas.ts';
import { ContextProviderStatistics } from '../contextProviderStatistics.ts';

async function getTraitsFromContextItems(ctx: Context, allContextItems: ContextItem[]): Promise<TraitWithIdType[]> {
  const matchedContextItems = allContextItems.filter((item) => item.matchScore > 0 && item.resolution !== 'error');
  const traitsContextItems = filterContextItemsBySchema(matchedContextItems, TraitWithIdSchema);
  for (const item of traitsContextItems) setupExpectationsForTraits(ctx, item.data, item.providerId);
  return traitsContextItems
    .flatMap((p) => p.data)
    .sort((a, b) => {
      return (a.importance ?? 0) - (b.importance ?? 0);
    });
}

function setupExpectationsForTraits(ctx: Context, traits: TraitType[], providerId: string) {
  const statistics = ctx.get(ContextProviderStatistics);
  const traitsExpectations = traits.map((t) => t.value);
  statistics.addExpectations(providerId, traitsExpectations);
}

function convertTraitsToRelatedFileTraits<T extends TraitType>(traits: T[]): (T & { includeInPrompt: true })[] {
  return traits.map((trait) => ({ ...trait, includeInPrompt: true }));
}

function addKindToRelatedFileTrait(
  trait: TraitType & { promptTextOverride?: TraitType['value'] }
):
  | { kind: 'string'; value: TraitType['value'] }
  | { kind: 'name-value'; name: TraitType['name']; value: TraitType['value'] } {
  return trait.promptTextOverride
    ? { kind: 'string', value: trait.promptTextOverride }
    : { kind: 'name-value', name: trait.name, value: trait.value };
}

export { addKindToRelatedFileTrait, convertTraitsToRelatedFileTraits, getTraitsFromContextItems };
