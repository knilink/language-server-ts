import { ElidableText } from '../../../../prompt/src/elidableText/index.ts';

type WeightStrategy = 'linear' | 'inverseLinear' | 'positional' | 'inversePositional';

function weighElidableList(elidableDocs: ElidableText.Chunk[], weightStrategy: WeightStrategy): ElidableText {
  if (elidableDocs.length === 0) return new ElidableText([]);
  const weightedElidableDocs: ElidableText.Chunk[] = elidableDocs.map((elidableDoc, index) => {
    let weight;
    switch (weightStrategy) {
      case 'linear':
        weight = 1 - index / elidableDocs.length;
        break;
      case 'inverseLinear':
        weight = (index + 1) / elidableDocs.length;
        break;
      case 'positional':
        weight = 1 / (index + 1);
        break;
      case 'inversePositional':
        weight = 1 / (elidableDocs.length - index);
        break;
      default:
        throw new Error('Unknown weight strategy: ' + weightStrategy);
    }
    if (Array.isArray(elidableDoc) && elidableDoc.length === 2) {
      weight *= elidableDoc[1];
      elidableDoc = elidableDoc[0];
    }
    return [elidableDoc, weight];
  });
  return new ElidableText(weightedElidableDocs);
}

export { weighElidableList };
