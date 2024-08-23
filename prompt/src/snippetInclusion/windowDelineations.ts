import '../indentation/parsing'; // TODO
import '../indentation/manipulation'; // TODO

function getBasicWindowDelineations(windowLength: number, lines: string[]): [number, number][] {
  const windows: [number, number][] = [];
  const length = lines.length;

  if (length === 0) return [];
  if (length < windowLength) return [[0, length]];

  for (let startLine = 0; startLine <= length - windowLength; startLine++) {
    windows.push([startLine, startLine + windowLength]);
  }

  return windows;
}

export { getBasicWindowDelineations };
