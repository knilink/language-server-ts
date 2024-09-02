import { Document } from '../types.ts';
import { fromTreeWithFocussedLines } from './fromIndentationTrees.ts'; // circular deps
import { Node, parseTree, flattenVirtual, visitTree, mapLabels, isLine, isBlank } from '../indentation/index.ts';

function elidableTextForSourceCode(
  contents: Document | string,
  focusOnLastLeaf: boolean = true,
  focusOnFirstLine: boolean = true
) {
  let tree = typeof contents === 'string' ? parseTree(contents) : parseTree(contents.source, contents.languageId);
  flattenVirtual(tree);

  const treeWithFocussedLines = mapLabels(tree, (label) => focusOnLastLeaf && label !== 'closer');

  visitTree(
    treeWithFocussedLines,
    (node: Node): void => {
      if (node.label === undefined) {
        node.label = focusOnLastLeaf;
      }
    },
    'topDown'
  );

  if (focusOnLastLeaf) {
    visitTree(
      treeWithFocussedLines,
      (node): void => {
        if (node.label) {
          let foundLastTrue = false;
          for (const subnode of [...node.subs].reverse()) {
            if (subnode.label && !foundLastTrue) {
              foundLastTrue = true;
            } else {
              subnode.label = false;
            }
          }
        } else {
          for (const subnode of node.subs) {
            subnode.label = false;
          }
        }
        if (node.subs.length > 0) {
          node.label = false;
        }
      },
      'topDown'
    );
  }

  if (focusOnFirstLine) {
    visitTree(
      treeWithFocussedLines,
      (node: Node): void => {
        if (!node.label) {
          node.label = isLine(node) || (isBlank(node) && node.lineNumber === 0);
        }
      },
      'topDown'
    );
  }

  return fromTreeWithFocussedLines(treeWithFocussedLines);
}

export { elidableTextForSourceCode };
