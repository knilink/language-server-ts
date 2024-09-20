import { SyntaxNode } from 'web-tree-sitter';
import {
  languageIdToWasmLanguageMapping,
  languageIdToWasmLanguage,
  isSupportedLanguageId,
  parseTreeSitter,
  queryPythonIsDocstring,
} from './parse.ts';

function getLineAtOffset(text: string, offset: number): string {
  const prevNewline = text.lastIndexOf('\n', offset - 1);
  const nextNewline = text.indexOf('\n', offset);

  if (nextNewline < 0) {
    return text.slice(prevNewline + 1, text.length);
  }

  return text.slice(prevNewline + 1, nextNewline);
}

function rewindToNearestNonWs(text: string, offset: number): number {
  let result = offset;
  for (; result > 0 && /\s/.test(text.charAt(result - 1)); ) result--;
  return result;
}

function indent(node: SyntaxNode, source: string): string | undefined {
  const startIndex = node.startIndex;
  const lineStart = startIndex - node.startPosition.column;
  const prefix = source.substring(lineStart, startIndex);

  if (/^\s*$/.test(prefix)) return prefix;
}

function outdented(fst: SyntaxNode, snd: SyntaxNode, source: string): boolean {
  if (snd.startPosition.row <= fst.startPosition.row) return false;

  const fstIndent = indent(fst, source);
  const sndIndent = indent(snd, source);

  return typeof fstIndent === 'string' && typeof sndIndent === 'string' && fstIndent.startsWith(sndIndent);
}

function getBlockParser(languageId: string): BaseBlockParser {
  return wasmLanguageToBlockParser[languageIdToWasmLanguage(languageId)];
}

async function isEmptyBlockStart(languageId: string, text: string, offset: number) {
  return isSupportedLanguageId(languageId) ? getBlockParser(languageId).isEmptyBlockStart(text, offset) : false;
}

async function isBlockBodyFinished(languageId: string, prefix: string, completion: string, offset: number) {
  if (isSupportedLanguageId(languageId))
    return getBlockParser(languageId).isBlockBodyFinished(prefix, completion, offset);
}

async function getNodeStart(languageId: string, text: string, offset: number) {
  if (isSupportedLanguageId(languageId)) return getBlockParser(languageId).getNodeStart(text, offset);
}

abstract class BaseBlockParser {
  languageId: string;
  nodeMatch: { [key: string]: string };
  nodeTypesWithBlockOrStmtChild: Map<string, string>;
  constructor(
    languageId: string,
    nodeMatch: { [key: string]: string },
    nodeTypesWithBlockOrStmtChild: Map<string, string>
  ) {
    this.languageId = languageId;
    this.nodeMatch = nodeMatch;
    this.nodeTypesWithBlockOrStmtChild = nodeTypesWithBlockOrStmtChild;
  }
  async getNodeMatchAtPosition<T>(text: string, offset: number, cb: (node: SyntaxNode) => T): Promise<T | undefined> {
    const tree = await parseTreeSitter(this.languageId, text);
    try {
      let nodeToComplete: SyntaxNode | null = tree.rootNode.descendantForIndex(offset);
      while (nodeToComplete) {
        let blockNodeType = this.nodeMatch[nodeToComplete.type];
        if (blockNodeType) {
          if (!this.nodeTypesWithBlockOrStmtChild.has(nodeToComplete.type)) break;
          const fieldLabel = this.nodeTypesWithBlockOrStmtChild.get(nodeToComplete.type) || '';
          const childToCheck =
            fieldLabel === '' ? nodeToComplete.namedChildren[0] : nodeToComplete.childForFieldName(fieldLabel);
          if (childToCheck?.type == blockNodeType) break;
        }
        nodeToComplete = nodeToComplete.parent;
      }
      if (nodeToComplete) {
        return cb(nodeToComplete);
      }
    } finally {
      tree.delete();
    }
  }

  async getNextBlockAtPosition<T>(text: string, offset: number, cb: (node: SyntaxNode) => T): Promise<T | undefined> {
    return await this.getNodeMatchAtPosition(text, offset, (nodeToComplete) => {
      let block = nodeToComplete.children.reverse().find((x) => x.type === this.nodeMatch[nodeToComplete.type]);
      if (!block) return;
      if (this.languageId === 'python' && block.parent) {
        const parent = block.parent.type === ':' ? block.parent.parent : block.parent;
        let nextComment = parent?.nextSibling;
        while (nextComment && nextComment.type === 'comment') {
          const commentInline =
            nextComment.startPosition.row === block.endPosition.row &&
            nextComment.startPosition.column >= block.endPosition.column;
          const commentAtEnd =
            nextComment.startPosition.row > parent!.endPosition.row &&
            nextComment.startPosition.column > parent!.startPosition.column;

          if (commentInline || commentAtEnd) {
            block = nextComment;
            nextComment = nextComment.nextSibling;
          } else break;
        }
      }

      if (!(block.endIndex >= block.tree.rootNode.endIndex - 1 && (block.hasError() || block.parent?.hasError()))) {
        return cb(block);
      }
    });
  }

  async isBlockBodyFinished(prefix: string, completion: string, offset: number): Promise<number | undefined> {
    const solution = (prefix + completion).trimEnd();
    const endIndex = await this.getNextBlockAtPosition(solution, offset, (block) => block.endIndex);
    if (typeof endIndex !== 'undefined' && endIndex < solution.length) {
      const lengthOfBlock = endIndex - prefix.length;
      if (lengthOfBlock > 0) return lengthOfBlock;
    }
  }

  async getNodeStart(text: string, offset: number): Promise<number | undefined> {
    let solution = text.trimEnd();
    return await this.getNodeMatchAtPosition(solution, offset, (block) => block.startIndex);
  }

  abstract isEmptyBlockStart(text: string, offset: number): Promise<boolean>;
}

class RegexBasedBlockParser extends BaseBlockParser {
  private blockEmptyMatch: string;
  private lineMatch: RegExp;

  constructor(
    languageId: string,
    blockEmptyMatch: string,
    lineMatch: RegExp,
    nodeMatch: { [key: string]: string },
    nodeTypesWithBlockOrStmtChild: Map<string, string>
  ) {
    super(languageId, nodeMatch, nodeTypesWithBlockOrStmtChild);
    this.blockEmptyMatch = blockEmptyMatch;
    this.lineMatch = lineMatch;
  }

  isBlockStart(line: string): boolean {
    return this.lineMatch.test(line.trimStart());
  }

  async isBlockBodyEmpty(text: string, offset: number): Promise<boolean> {
    const res = await this.getNextBlockAtPosition(text, offset, (block) => {
      if (block.startIndex < offset) {
        offset = block.startIndex;
      }
      const blockText = text.substring(offset, block.endIndex).trim();
      return blockText === '' || blockText.replace(/\s/g, '') === this.blockEmptyMatch;
    });
    return res === undefined || res;
  }

  async isEmptyBlockStart(text: string, offset: number): Promise<boolean> {
    offset = rewindToNearestNonWs(text, offset);
    const line = getLineAtOffset(text, offset);
    return this.isBlockStart(line) && (await this.isBlockBodyEmpty(text, offset));
  }
}

class TreeSitterBasedBlockParser extends BaseBlockParser {
  startKeywords: string[];
  blockNodeType: string;
  emptyStatementType: string | null;
  curlyBraceLanguage: boolean;

  constructor(
    languageId: string,
    nodeMatch: { [key: string]: string },
    nodeTypesWithBlockOrStmtChild: Map<string, string>,
    startKeywords: string[],
    blockNodeType: string,
    emptyStatementType: string | null,
    curlyBraceLanguage: boolean
  ) {
    super(languageId, nodeMatch, nodeTypesWithBlockOrStmtChild);
    this.startKeywords = startKeywords;
    this.blockNodeType = blockNodeType;
    this.emptyStatementType = emptyStatementType;
    this.curlyBraceLanguage = curlyBraceLanguage;
  }

  isBlockEmpty(block: SyntaxNode, offset: number): boolean {
    let trimmed = block.text.trim();

    if (this.curlyBraceLanguage) {
      if (trimmed.startsWith('{')) trimmed = trimmed.slice(1);
      if (trimmed.endsWith('}')) trimmed = trimmed.slice(0, -1);
      trimmed = trimmed.trim();
    }

    const blockParent = block.parent;
    return !!(
      trimmed.length === 0 ||
      (this.languageId === 'python' &&
        blockParent?.type === 'class_definition' &&
        block.children.length === 1 &&
        queryPythonIsDocstring(block.parent!))
    );
  }

  async isEmptyBlockStart(text: string, offset: number): Promise<boolean> {
    if (offset > text.length) throw new RangeError('Invalid offset');

    for (let i = offset; i < text.length && text.charAt(i) !== `\n`; i++) if (/\S/.test(text.charAt(i))) return false;
    offset = rewindToNearestNonWs(text, offset);
    const tree = await parseTreeSitter(this.languageId, text);
    try {
      const nodeAtPos = tree.rootNode.descendantForIndex(offset - 1);
      if (nodeAtPos == null || (this.curlyBraceLanguage && nodeAtPos.type == '}')) return false;
      if (
        (this.languageId == 'javascript' || this.languageId == 'typescript') &&
        nodeAtPos.parent &&
        nodeAtPos.parent.type == 'object' &&
        nodeAtPos.parent.text.trim() == '{'
      )
        return true;
      if (this.languageId == 'typescript') {
        let currNode = nodeAtPos;
        while (currNode.parent) {
          if (currNode.type == 'function_signature' || currNode.type == 'method_signature') {
            const next = nodeAtPos.nextSibling;
            return next && currNode.hasError() && outdented(currNode, next, text)
              ? true
              : !currNode.children.find((c) => c.type == ';') && currNode.endIndex <= offset;
          }
          currNode = currNode.parent;
        }
      }

      let errorNode: SyntaxNode | null = null;
      let blockNode: SyntaxNode | null = null;
      let blockParentNode: SyntaxNode | null = null;
      let currNode: SyntaxNode | null = nodeAtPos;
      while (currNode != null) {
        if (currNode.type == this.blockNodeType) {
          blockNode = currNode;
          break;
        }
        if (this.nodeMatch[currNode.type]) {
          blockParentNode = currNode;
          break;
        }
        if (currNode.type == 'ERROR') {
          errorNode = currNode;
          break;
        }
        currNode = currNode.parent;
      }

      if (blockNode != null) {
        if (!blockNode.parent || !this.nodeMatch[blockNode.parent.type]) return false;
        if (this.languageId == 'python') {
          let prevSibling = blockNode.previousSibling;
          const flag =
            prevSibling != null &&
            prevSibling.hasError() &&
            (prevSibling.text.startsWith('"""') || prevSibling.text.startsWith("'''"));
          if (flag) return true;
        }
        return this.isBlockEmpty(blockNode, offset);
      }
      if (errorNode != null) {
        if (
          errorNode.previousSibling?.type === 'module' ||
          errorNode.previousSibling?.type === 'internal_module' ||
          errorNode.previousSibling?.type === 'def'
        )
          return true;
        const children = [...errorNode.children].reverse();
        const keyword = children.find((child) => this.startKeywords.includes(child.type));
        let block = children.find((child) => child.type == this.blockNodeType);

        if (keyword) {
          switch (this.languageId) {
            case 'python': {
              if (keyword.type == 'try' && nodeAtPos.type == 'identifier' && nodeAtPos.text.length > 4) {
                block = children.find((child) => child.hasError())?.children.find((child) => child.type == 'block');
              }
              let colonNode;
              let parenCount = 0;
              for (let child of errorNode.children) {
                if (child.type === ':' && parenCount === 0) {
                  colonNode = child;
                  break;
                }
                child.type === '(' && (parenCount += 1), child.type == ')' && (parenCount -= 1);
              }
              if (colonNode && keyword.endIndex <= colonNode.startIndex && colonNode.nextSibling) {
                if (keyword.type === 'def') {
                  let sibling = colonNode.nextSibling;
                  if (
                    sibling.type === '"' ||
                    sibling.type === "'" ||
                    (sibling.type === 'ERROR' && (sibling.text == '"""' || sibling.text == "'''"))
                  )
                    return true;
                }
                return false;
              }
              break;
            }
            case 'javascript': {
              let formalParameters = children.find((child) => child.type == 'formal_parameters');
              if (keyword.type == 'class' && formalParameters) return true;
              let leftCurlyBrace = children.find((child) => child.type == '{');
              if (
                (leftCurlyBrace &&
                  leftCurlyBrace.startIndex > keyword.endIndex &&
                  leftCurlyBrace.nextSibling != null) ||
                (children.find((child) => child.type == 'do') && keyword.type == 'while') ||
                (keyword.type == '=>' && keyword.nextSibling && keyword.nextSibling.type != '{')
              )
                return false;
              break;
            }
            case 'typescript': {
              let leftCurlyBrace = children.find((child) => child.type == '{');
              if (
                (leftCurlyBrace &&
                  leftCurlyBrace.startIndex > keyword.endIndex &&
                  leftCurlyBrace.nextSibling != null) ||
                (children.find((child) => child.type == 'do') && keyword.type == 'while') ||
                (keyword.type == '=>' && keyword.nextSibling && keyword.nextSibling.type != '{')
              )
                return false;
              break;
            }
          }
          return block && block.startIndex > keyword.endIndex ? this.isBlockEmpty(block, offset) : true;
        }
      }
      if (blockParentNode != null) {
        let expectedType = this.nodeMatch[blockParentNode.type],
          block = blockParentNode.children
            .slice()
            .reverse()
            .find((x) => x.type == expectedType);
        if (block) return this.isBlockEmpty(block, offset);
        if (this.nodeTypesWithBlockOrStmtChild.has(blockParentNode.type)) {
          const fieldLabel = this.nodeTypesWithBlockOrStmtChild.get(blockParentNode.type) || '';
          const child = fieldLabel === '' ? blockParentNode.children[0] : blockParentNode.childForFieldName(fieldLabel);
          if (child && child.type !== this.blockNodeType && child.type !== this.emptyStatementType) return false;
        }
        return true;
      }
      return false;
    } finally {
      tree.delete();
    }
  }
}

const wasmLanguageToBlockParser: {
  [key in (typeof languageIdToWasmLanguageMapping)[keyof typeof languageIdToWasmLanguageMapping]]: BaseBlockParser;
} = {
  python: new TreeSitterBasedBlockParser(
    'python',
    {
      class_definition: 'block',
      elif_clause: 'block',
      else_clause: 'block',
      except_clause: 'block',
      finally_clause: 'block',
      for_statement: 'block',
      function_definition: 'block',
      if_statement: 'block',
      try_statement: 'block',
      while_statement: 'block',
      with_statement: 'block',
    },
    new Map(),
    ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with'],
    'block',
    null,
    false
  ),
  javascript: new TreeSitterBasedBlockParser(
    'javascript',
    {
      arrow_function: 'statement_block',
      catch_clause: 'statement_block',
      do_statement: 'statement_block',
      else_clause: 'statement_block',
      finally_clause: 'statement_block',
      for_in_statement: 'statement_block',
      for_statement: 'statement_block',
      function: 'statement_block',
      function_declaration: 'statement_block',
      generator_function: 'statement_block',
      generator_function_declaration: 'statement_block',
      if_statement: 'statement_block',
      method_definition: 'statement_block',
      try_statement: 'statement_block',
      while_statement: 'statement_block',
      with_statement: 'statement_block',
      class: 'class_body',
      class_declaration: 'class_body',
    },
    new Map([
      ['arrow_function', 'body'],
      ['do_statement', 'body'],
      ['else_clause', ''],
      ['for_in_statement', 'body'],
      ['for_statement', 'body'],
      ['if_statement', 'consequence'],
      ['while_statement', 'body'],
      ['with_statement', 'body'],
    ]),
    ['=>', 'try', 'catch', 'finally', 'do', 'for', 'if', 'else', 'while', 'with', 'function', 'function*', 'class'],
    'statement_block',
    'empty_statement',
    !0
  ),
  typescript: new TreeSitterBasedBlockParser(
    'typescript',
    {
      ambient_declaration: 'statement_block',
      arrow_function: 'statement_block',
      catch_clause: 'statement_block',
      do_statement: 'statement_block',
      else_clause: 'statement_block',
      finally_clause: 'statement_block',
      for_in_statement: 'statement_block',
      for_statement: 'statement_block',
      function: 'statement_block',
      function_declaration: 'statement_block',
      generator_function: 'statement_block',
      generator_function_declaration: 'statement_block',
      if_statement: 'statement_block',
      internal_module: 'statement_block',
      method_definition: 'statement_block',
      module: 'statement_block',
      try_statement: 'statement_block',
      while_statement: 'statement_block',
      abstract_class_declaration: 'class_body',
      class: 'class_body',
      class_declaration: 'class_body',
    },
    new Map([
      ['arrow_function', 'body'],
      ['do_statement', 'body'],
      ['else_clause', ''],
      ['for_in_statement', 'body'],
      ['for_statement', 'body'],
      ['if_statement', 'consequence'],
      ['while_statement', 'body'],
      ['with_statement', 'body'],
    ]),
    [
      'declare',
      '=>',
      'try',
      'catch',
      'finally',
      'do',
      'for',
      'if',
      'else',
      'while',
      'with',
      'function',
      'function*',
      'class',
    ],
    'statement_block',
    'empty_statement',
    !0
  ),
  tsx: new TreeSitterBasedBlockParser(
    'typescriptreact',
    {
      ambient_declaration: 'statement_block',
      arrow_function: 'statement_block',
      catch_clause: 'statement_block',
      do_statement: 'statement_block',
      else_clause: 'statement_block',
      finally_clause: 'statement_block',
      for_in_statement: 'statement_block',
      for_statement: 'statement_block',
      function: 'statement_block',
      function_declaration: 'statement_block',
      generator_function: 'statement_block',
      generator_function_declaration: 'statement_block',
      if_statement: 'statement_block',
      internal_module: 'statement_block',
      method_definition: 'statement_block',
      module: 'statement_block',
      try_statement: 'statement_block',
      while_statement: 'statement_block',
      abstract_class_declaration: 'class_body',
      class: 'class_body',
      class_declaration: 'class_body',
    },
    new Map([
      ['arrow_function', 'body'],
      ['do_statement', 'body'],
      ['else_clause', ''],
      ['for_in_statement', 'body'],
      ['for_statement', 'body'],
      ['if_statement', 'consequence'],
      ['while_statement', 'body'],
      ['with_statement', 'body'],
    ]),
    [
      'declare',
      '=>',
      'try',
      'catch',
      'finally',
      'do',
      'for',
      'if',
      'else',
      'while',
      'with',
      'function',
      'function*',
      'class',
    ],
    'statement_block',
    'empty_statement',
    true
  ),
  go: new RegexBasedBlockParser(
    'go',
    '{}',
    /\b(func|if|else|for)\b/,
    {
      communication_case: 'block',
      default_case: 'block',
      expression_case: 'block',
      for_statement: 'block',
      func_literal: 'block',
      function_declaration: 'block',
      if_statement: 'block',
      labeled_statement: 'block',
      method_declaration: 'block',
      type_case: 'block',
    },
    new Map()
  ),
  ruby: new RegexBasedBlockParser(
    'ruby',
    'end',
    /\b(BEGIN|END|case|class|def|do|else|elsif|for|if|module|unless|until|while)\b|->/,
    {
      begin_block: '}',
      block: '}',
      end_block: '}',
      lambda: 'block',
      for: 'do',
      until: 'do',
      while: 'do',
      case: 'end',
      do: 'end',
      if: 'end',
      method: 'end',
      module: 'end',
      unless: 'end',
      do_block: 'end',
    },
    new Map()
  ),
};

export { isEmptyBlockStart, isBlockBodyFinished, getNodeStart };
