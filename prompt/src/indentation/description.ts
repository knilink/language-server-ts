import { LineNode } from './classes.ts';
import './manipulation.ts';

function deparseLine(node: LineNode): string {
  return ' '.repeat(node.indentation) + node.sourceLine + `\n`;
}

export { deparseLine };
