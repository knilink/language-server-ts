import { LineNode } from './classes';
import './manipulation';

function deparseLine(node: LineNode): string {
  return ' '.repeat(node.indentation) + node.sourceLine + `\n`;
}

export { deparseLine };
