import { Node, TopNode, isBlank } from "./classes.ts";
import { labelLines, buildLabelRules, groupBlocks, flattenVirtual, labelVirtualInherited } from "./parsing.ts";

const _MarkdownLabelRules = { heading: /^# /, subheading: /^## /, subsubheading: /### / };
const MarkdownLabelRules = buildLabelRules(_MarkdownLabelRules);

function processMarkdown(originalTree: TopNode): Node {
  let tree: Node = originalTree;
  if ((labelLines(tree, MarkdownLabelRules), isBlank(tree))) return tree;

  function headingLevel(sub: Node): number | undefined {
    if (sub.label === 'heading') return 1;
    if (sub.label === 'subheading') return 2;
    if (sub.label === 'subsubheading') return 3;
    return undefined;
  }

  const currentHierarchy: Node[] = [tree];
  const oldTreeSubs = [...tree.subs];

  tree.subs = [];

  for (const sub of oldTreeSubs) {
    const level = headingLevel(sub);

    if (level === undefined || isBlank(sub)) {
      currentHierarchy[currentHierarchy.length - 1].subs.push(sub);
    } else {
      while (currentHierarchy.length < level) currentHierarchy.push(currentHierarchy[currentHierarchy.length - 1]);

      currentHierarchy[level - 1].subs.push(sub);
      currentHierarchy[level] = sub;

      while (currentHierarchy.length > level + 1) currentHierarchy.pop();
    }
  }
  tree = groupBlocks(tree);
  tree = flattenVirtual(tree);
  labelVirtualInherited(tree);
  return tree;
}

export { processMarkdown };
