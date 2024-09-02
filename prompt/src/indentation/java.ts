import { TopNode, Node, isBlank } from './classes.ts';
import {
  buildLabelRules,
  labelLines,
  combineClosersAndOpeners,
  flattenVirtual,
  labelVirtualInherited,
} from './parsing.ts';
import { visitTree } from './manipulation.ts';

function processJava(originalTree: TopNode): Node {
  let tree: Node = originalTree;
  labelLines(tree, javaLabelRules);
  tree = combineClosersAndOpeners(tree);
  tree = flattenVirtual(tree);
  labelVirtualInherited(tree);
  visitTree(
    tree,
    (tree) => {
      if (tree.label === 'class' || tree.label === 'interface') {
        for (let sub of tree.subs) {
          if (!isBlank(sub) && (sub.label === undefined || sub.label === 'annotation')) {
            sub.label = 'member';
          }
        }
      }
    },
    'bottomUp'
  );
  return tree;
}

const _javaLabelRules: { [key: string]: RegExp } = {
  package: /^package /,
  import: /^import /,
  class: /\bclass /,
  interface: /\binterface /,
  javadoc: /^\/\*\*/,
  comment_multi: /^\/\*[^*]/,
  comment_single: /^\/\//,
  annotation: /^@/,
  opener: /^[\[({]/,
  closer: /^[\])}]/,
};

const javaLabelRules = buildLabelRules(_javaLabelRules);

export { processJava };
