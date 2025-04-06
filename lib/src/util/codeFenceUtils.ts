export function getFenceForCodeBlock(code: string): string {
  const backticks = code.matchAll(/^\s*(```+)/gm);
  const backticksNeeded = Math.max(3, ...Array.from(backticks, (d) => d[1].length + 1));
  return '`'.repeat(backticksNeeded);
}
