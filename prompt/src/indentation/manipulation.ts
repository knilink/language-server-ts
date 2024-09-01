import { topNode, Node, Label } from "./classes.ts";

function clearLabelsIf(tree: Node, condition: (label: Label) => boolean): Node {
  return (
    visitTree(
      tree,
      (node: Node) => {
        node.label = node.label ? (condition(node.label) ? undefined : node.label) : undefined;
      },
      'bottomUp'
    ),
    tree
  );
}

function mapLabels<T extends Label>(tree: Node, mapper: (label: Label) => T | undefined): Node<T> {
  switch (tree.type) {
    case 'line':
    case 'virtual':
      const newSubs = tree.subs?.map((sub) => mapLabels(sub, mapper));
      return { ...tree, subs: newSubs, label: tree.label ? mapper(tree.label) : undefined };
    case 'blank':
      return { ...tree, label: tree.label ? mapper(tree.label) : undefined };
    case 'top':
      const topSubs = tree.subs?.map((sub) => mapLabels(sub, mapper));
      return {
        ...tree,
        subs: topSubs,
        label: tree.label ? mapper(tree.label) : undefined,
      };
  }
}

function visitTree<T extends Label>(
  tree: Node<T>,
  visitor: (node: Node<T>) => void,
  direction: 'topDown' | 'bottomUp'
): void {
  function _visit(node: Node<T>): void {
    if (direction === 'topDown') visitor(node);
    node.subs?.forEach((subtree) => {
      _visit(subtree);
    });
    if (direction === 'bottomUp') visitor(node);
  }

  _visit(tree);
}

function foldTree<T extends Label, ACC>(
  tree: Node<T>,
  init: ACC,
  accumulator: (node: Node<T>, acc: ACC) => ACC,
  direction: 'topDown' | 'bottomUp'
): ACC {
  let acc = init;
  function visitor(node: Node<T>): void {
    acc = accumulator(node, acc);
  }
  visitTree(tree, visitor, direction);
  return acc;
}

function rebuildTree(tree: Node, visitor: (node: Node) => void, skip?: (node: Node) => boolean): Node {
  const rebuild = (node: Node): Node | undefined => {
    if (skip !== undefined && skip(node)) return node;
    const newSubs = node.subs?.map(rebuild).filter((sub): sub is Node => sub !== undefined);
    node.subs = newSubs;
    visitor(node);
    return node;
  };
  const rebuiltTree = rebuild(tree);
  return rebuiltTree !== undefined ? rebuiltTree : topNode();
}

export { clearLabelsIf, mapLabels, visitTree, foldTree, rebuildTree };
