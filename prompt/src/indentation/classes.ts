// ../prompt/src/indentation/classes.ts

type Label =
  // ./parsing.ts
  | string
  // number only ../elidableText/fromIndentationTrees.ts
  | number
  // ../elidableText/fromSourceCode.ts wtf
  | boolean;

type BaseNode<T extends Label = Label> = {
  subs: Node<T>[];
  label?: T;
};

type VirtualNode<T extends Label = Label> = BaseNode<T> & {
  type: 'virtual';
  indentation: number;
};

type LineNode<T extends Label = Label> = BaseNode<T> & {
  type: 'line';
  indentation: number;
  lineNumber: number;
  sourceLine: string;
};

type BlankNode<T extends Label = Label> = BaseNode<T> & {
  type: 'blank';
  lineNumber: number;
  subs: [];
};

type TopNode<T extends Label = Label> = BaseNode<T> & {
  type: 'top';
  indentation: -1;
};

type Node<T extends Label = Label> = VirtualNode<T> | LineNode<T> | BlankNode<T> | TopNode<T>;

function virtualNode<T extends Label>(indentation: number, subs: Node<T>[], label?: T): VirtualNode<T> {
  return { type: 'virtual', indentation, subs, label };
}

function lineNode<T extends Label>(
  indentation: number,
  lineNumber: number,
  sourceLine: string,
  subs: Node<T>[],
  label?: T
): LineNode<T> {
  if (sourceLine === '') throw new Error('Cannot create a line node with an empty source line');
  return { type: 'line', indentation, lineNumber, sourceLine, subs, label };
}

function blankNode(lineNumber: number): BlankNode<Label> {
  return { type: 'blank', lineNumber, subs: [] };
}

function topNode(subs?: Node[]): TopNode<Label> {
  return { type: 'top', indentation: -1, subs: subs != null ? subs : [] };
}

function isBlank<T extends Label>(tree: Node<T>): tree is BlankNode<T> {
  return tree.type === 'blank';
}

function isLine<T extends Label>(tree: Node<T>): tree is LineNode<T> {
  return tree.type === 'line';
}

function isVirtual<T extends Label>(tree: Node<T>): tree is VirtualNode<T> {
  return tree.type === 'virtual';
}

export {
  Node,
  VirtualNode,
  LineNode,
  BlankNode,
  TopNode,
  virtualNode,
  lineNode,
  blankNode,
  topNode,
  isBlank,
  isLine,
  isVirtual,
  Label,
};
