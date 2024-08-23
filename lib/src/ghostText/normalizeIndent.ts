function normalizeIndentCharacter<T extends { displayText: string; completionText: string }>(
  // ../../../agent/src/methods/getCompletions.ts
  options: { tabSize?: number; insertSpaces?: boolean },
  completion: T,
  isEmptyLine: boolean
): T {
  function replace(text: string, toReplace: string, replacer: (n: number) => string): string {
    const regex = new RegExp(`^(${toReplace})+`, 'g');
    return text
      .split('\n')
      .map((line) => {
        const trimmed = line.replace(regex, '');
        const removedCharacters = line.length - trimmed.length;
        return replacer(removedCharacters) + trimmed;
      })
      .join('\n');
  }

  let indentSize: number;
  if (options.tabSize === undefined || typeof options.tabSize === 'string') {
    indentSize = 4;
  } else {
    indentSize = options.tabSize!;
  }

  if (!options.insertSpaces) {
    const r = (txt: string): string =>
      replace(txt, ' ', (n) => '\t'.repeat(Math.floor(n / indentSize)) + ' '.repeat(n % indentSize));
    completion.displayText = r(completion.displayText);
    completion.completionText = r(completion.completionText);
  } else if (options.insertSpaces) {
    const r = (txt: string): string => replace(txt, '\t', (n) => ' '.repeat(n * indentSize));
    completion.displayText = r(completion.displayText);
    completion.completionText = r(completion.completionText);

    if (isEmptyLine) {
      const re = (txt: string): string => {
        const spacesAtStart = txt.length - txt.trimStart().length;
        const remainder = spacesAtStart % indentSize;
        if (remainder !== 0 && spacesAtStart > 0) {
          const toReplace = ' '.repeat(remainder);
          return replace(txt, toReplace, (n) => ' '.repeat((Math.floor(n / indentSize) + 1) * indentSize));
        } else {
          return txt;
        }
      };
      completion.displayText = re(completion.displayText);
      completion.completionText = re(completion.completionText);
    }
  }

  return completion;
}

export { normalizeIndentCharacter };
