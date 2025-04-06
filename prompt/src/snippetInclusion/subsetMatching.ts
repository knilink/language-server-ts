import { getCursorContext } from './cursorContext.ts';
import { WindowedMatcher } from './selectRelevance.ts';
import { getBasicWindowDelineations } from './windowDelineations.ts';
import { parseTreeSitter } from '../parse.ts';
import { CurrentDocument } from '../types.ts';
import { SyntaxNode } from 'web-tree-sitter';

function computeScore<T>(a: Set<T>, b: Set<T>): number {
  let subsetOverlap = new Set<T>();

  b.forEach((x) => {
    if (a.has(x)) {
      subsetOverlap.add(x);
    }
  });

  return subsetOverlap.size;
}

class BlockTokenSubsetMatcher extends WindowedMatcher {
  constructor(
    referenceDoc: CurrentDocument,
    readonly windowLength: number
  ) {
    super(referenceDoc);
  }
  id() {
    return 'fixed:' + this.windowLength;
  }

  getWindowsDelineations(lines: string[]) {
    return getBasicWindowDelineations(this.windowLength, lines);
  }

  _getCursorContextInfo(referenceDoc: CurrentDocument) {
    return getCursorContext(referenceDoc, { maxLineCount: this.windowLength });
  }

  get referenceTokens(): Promise<Set<string>> {
    return this.createReferenceTokensForLanguage();
  }

  async createReferenceTokensForLanguage(): Promise<Set<string>> {
    if (this.referenceTokensCache) {
      return this.referenceTokensCache;
    }

    if (BlockTokenSubsetMatcher.syntaxAwareSupportsLanguage(this.referenceDoc.languageId)) {
      this.referenceTokensCache = await this.syntaxAwareReferenceTokens();
    } else {
      this.referenceTokensCache = await super.referenceTokens;
    }

    return this.referenceTokensCache;
  }

  async syntaxAwareReferenceTokens() {
    const start = (await this.getEnclosingMemberStart(this.referenceDoc.source, this.referenceDoc.offset))?.startIndex;
    const end = this.referenceDoc.offset;
    const text = start
      ? this.referenceDoc.source.slice(start, end)
      : getCursorContext(this.referenceDoc, { maxLineCount: this.windowLength }).context;
    return this.tokenizer.tokenize(text);
  }

  static syntaxAwareSupportsLanguage(languageId: string): boolean {
    switch (languageId) {
      case 'csharp':
        return true;
      default:
        return false;
    }
  }

  similarityScore<T>(a: Set<T>, b: Set<T>) {
    return computeScore(a, b);
  }

  async getEnclosingMemberStart(text: string, offset: number) {
    let tree;
    try {
      tree = await parseTreeSitter(this.referenceDoc.languageId, text);
      let nodeAtPos: SyntaxNode | null = tree.rootNode.namedDescendantForIndex(offset);
      while (
        nodeAtPos &&
        !(BlockTokenSubsetMatcher.isMember(nodeAtPos) || BlockTokenSubsetMatcher.isBlock(nodeAtPos))
      ) {
        nodeAtPos = nodeAtPos.parent;
      }
      return nodeAtPos;
    } finally {
      tree?.delete();
    }
  }

  static isMember(node: SyntaxNode) {
    switch (node?.type) {
      case 'method_declaration':
      case 'property_declaration':
      case 'field_declaration':
      case 'constructor_declaration':
        return true;
      default:
        return false;
    }
  }

  static isBlock(node: SyntaxNode) {
    switch (node?.type) {
      case 'class_declaration':
      case 'struct_declaration':
      case 'record_declaration':
      case 'enum_declaration':
      case 'interface_declaration':
        return true;
      default:
        return false;
    }
  }

  static FACTORY(windowLength: number) {
    return {
      to: (referenceDoc: CurrentDocument) => new BlockTokenSubsetMatcher(referenceDoc, windowLength),
    };
  }
}

export { BlockTokenSubsetMatcher };
