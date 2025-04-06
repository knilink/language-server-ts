const contextualFilterLanguageMap: { [key: string]: number } = [
  'javascript',
  'typescript',
  'typescriptreact',
  'python',
  'vue',
  'php',
  'dart',
  'javascriptreact',
  'go',
  'css',
  'cpp',
  'html',
  'scss',
  'markdown',
  'csharp',
  'java',
  'json',
  'rust',
  'ruby',
  'c',
].reduce((s: { [key: string]: number }, c, i) => ((s[c] = i + 1), s), {});

const contextualFilterCharacterMap: { [key: string]: number } =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
    .split('')
    .reduce((s: { [key: string]: number }, c: string, i: number) => ((s[c] = i + 1), s), {});

export { contextualFilterLanguageMap, contextualFilterCharacterMap };
