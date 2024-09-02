import { ElidableText } from './elidableText.ts'; // circular deps
import { Node, Label, mapLabels, visitTree, isBlank, deparseLine, foldTree } from '../indentation/index.ts';

const DEFAULT_TREE_TRAVERSAL_CONFIG = {
  worthUp: 0.9,
  worthSibling: 0.88,
  worthDown: 0.8,
};

function fromTreeWithFocussedLines(
  tree: Node,
  config: { worthUp: number; worthSibling: number; worthDown: number } = DEFAULT_TREE_TRAVERSAL_CONFIG
): ElidableText {
  const treeWithDistances: Node<number> = mapLabels<number>(tree, (x?: Label): number | undefined =>
    x ? 1 : undefined
  );
  visitTree(
    treeWithDistances,
    (node: Node<number>) => {
      if (isBlank(node)) return;

      let maxChildLabel = node.subs.reduce((memo, child) => {
        return Math.max(memo, child.label ?? 0);
      }, 0);
      node.label = Math.max(node.label ?? 0, maxChildLabel * config.worthUp);
    },
    'bottomUp'
  );
  visitTree(
    treeWithDistances,
    (node: Node<number>) => {
      if (isBlank(node)) return;
      let values = node.subs.map((sub) => sub.label ?? 0);
      let newValues = [...values];
      for (let i = 0; i < values.length; i++) {
        if (values[i] !== 0) {
          newValues = newValues.map((v, j) => Math.max(v, Math.pow(config.worthSibling, Math.abs(i - j)) * values[i]));
        }
      }
      let nodeLabel = node.label;
      if (nodeLabel !== undefined) {
        newValues = newValues.map((v) => Math.max(v, config.worthDown * nodeLabel));
      }
      node.subs.forEach((sub, i) => {
        sub.label = newValues[i];
      });
    },
    'topDown'
  );
  return fromTreeWithValuedLines(treeWithDistances);
}

function fromTreeWithValuedLines(tree: Node<number>): ElidableText {
  let valuedLines = foldTree<number, [string, number][]>(
    tree,
    [],
    (node, acc) => {
      if ((node.type === 'line' || node.type === 'blank') && node.label !== undefined) {
        const line = node.type === 'line' ? deparseLine(node).trimEnd() : '';
        acc.push([line, node.label]);
      }
      return acc;
    },
    'topDown'
  );
  return new ElidableText(valuedLines);
}

export { fromTreeWithValuedLines, fromTreeWithFocussedLines };
