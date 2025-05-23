import { fileURLToPath } from 'node:url';
import * as fs from 'fs';
import * as path from 'path';
import { SyntaxNode, QueryMatch, Query } from 'web-tree-sitter';
import Parser from 'web-tree-sitter';
import { CopilotPromptLoadFailure } from './error.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadWasmLanguage(language: string): Promise<Parser.Language> {
  let treeSitterPath: string;
  const extname = path.extname(__filename);
  if (extname !== '.ts') {
    treeSitterPath = path.resolve(__dirname, `tree-sitter-${language}.wasm`);
  } else {
    treeSitterPath = path.resolve(__dirname, '../../dist', `tree-sitter-${language}.wasm`);
  }

  let wasmBytes: Buffer;
  try {
    wasmBytes = await fs.promises.readFile(treeSitterPath);
  } catch (e) {
    if (e instanceof Error && 'code' in e && typeof e.code == 'string' && e.name === 'Error') {
      throw new CopilotPromptLoadFailure(`Could not load tree-sitter-${language}.wasm`, e);
    }
    throw e;
  }

  return Parser.Language.load(wasmBytes);
}

function getLanguage(language: string): Promise<Parser.Language> {
  const wasmLanguage = languageIdToWasmLanguage(language);
  let loadedLang = loadWasmLanguage(wasmLanguage);
  if (!loadedLang) {
    loadedLang = loadWasmLanguage(wasmLanguage);
    languageLoadPromises.set(wasmLanguage, loadedLang);
  }
  return loadedLang;
}

function isSupportedLanguageId(languageId: string): boolean {
  return languageId in languageIdToWasmLanguageMapping && languageId !== 'csharp' && languageId !== 'java';
}

function languageIdToWasmLanguage(languageId: string): string {
  if (!(languageId in languageIdToWasmLanguageMapping)) throw new Error(`Unrecognized language: ${languageId}`);
  return languageIdToWasmLanguageMapping[languageId];
}

async function parseTreeSitter(language: string, source: string): Promise<Parser.Tree> {
  await Parser.init();
  let parser: Parser;
  try {
    parser = new Parser();
  } catch (e) {
    if (
      e &&
      typeof e == 'object' &&
      'message' in e &&
      typeof e.message == 'string' &&
      e.message.includes('table index is out of bounds')
    ) {
      throw new WrappedError(`Could not init Parse for language <${language}>`, e);
    }
    throw e;
  }

  const treeSitterLanguage = await getLanguage(language);
  parser.setLanguage(treeSitterLanguage);
  const parsedTree = parser.parse(source);
  parser.delete();
  return parsedTree;
}

function getBlockCloseToken(language: string): string | null {
  switch (languageIdToWasmLanguage(language)) {
    case 'python':
      return null;
    case 'javascript':
    case 'typescript':
    case 'tsx':
    case 'go':
    case 'c_sharp':
    case 'java':
      return '}';
    case 'ruby':
      return 'end';
  }
  return null;
}

const docstringQuery: [string] = [
  `[
(class_definition (block (expression_statement (string))))
(function_definition (block (expression_statement (string))))
]`,
];

function innerQuery(queries: [string, Query?][], root: SyntaxNode): any[] {
  const matches: QueryMatch[] = [];
  for (const query of queries) {
    if (!query[1]) {
      const lang = root.tree.getLanguage();
      query[1] = lang.query(query[0]);
    }
    matches.push(...query[1].matches(root));
  }
  return matches;
}

function queryPythonIsDocstring(blockNode: SyntaxNode): boolean {
  return innerQuery([docstringQuery], blockNode).length === 1;
}

const languageIdToWasmLanguageMapping: { [key: string]: string } = {
  python: 'python',
  javascript: 'javascript',
  javascriptreact: 'javascript',
  jsx: 'javascript',
  typescript: 'typescript',
  typescriptreact: 'tsx',
  go: 'go',
  ruby: 'ruby',
  csharp: 'c_sharp',
  java: 'java',
};

const languageLoadPromises = new Map<string, Promise<Parser.Language>>();

class WrappedError extends Error {
  constructor(
    message: string,
    public cause: unknown
  ) {
    super(message);
  }
}

export {
  getBlockCloseToken,
  languageIdToWasmLanguageMapping,
  languageIdToWasmLanguage,
  isSupportedLanguageId,
  parseTreeSitter,
  queryPythonIsDocstring,
};
