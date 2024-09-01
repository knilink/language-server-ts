import { clearLabelsIf, visitTree, rebuildTree } from "./manipulation.ts";
import {
  Node,
  Label,
  TopNode,
  BlankNode,
  lineNode,
  virtualNode,
  topNode,
  blankNode,
  isLine,
  isVirtual,
  isBlank,
} from "./classes.ts";

type Matches = (sourceLine: string) => boolean;
type LabelRule = { matches: Matches; label: Label };

const LANGUAGE_SPECIFIC_PARSERS: { [key: string]: (node: TopNode) => Node } = {};
const _genericLabelRules = { opener: /^[\[({]/, closer: /^[\])}]/ };
const genericLabelRules = buildLabelRules(_genericLabelRules);

function parseRaw(source: string): TopNode {
  const rawLines = source.split('\n');
  const indentations = rawLines.map((line) => line.match(/^\s*/)![0].length);
  const lines = rawLines.map((line) => line.trimStart());

  function parseNode(line: number): [Node, number] {
    let [subs, nextLine] = parseSubs(line + 1, indentations[line]);
    return [lineNode(indentations[line], line, lines[line], subs), nextLine];
  }

  function parseSubs(initialLine: number, parentIndentation: number): [Node[], number] {
    let sub: Node;
    const subs: Node[] = [];
    let line = initialLine;
    let lastBlank: number | undefined;

    while (line < lines.length && (lines[line] === '' || indentations[line] > parentIndentation)) {
      if (lines[line] === '') {
        if (lastBlank === undefined) {
          lastBlank = line;
        }
        line += 1;
      } else {
        if (lastBlank !== undefined) {
          for (let i = lastBlank!; i < line; i++) subs.push(blankNode(i));
          lastBlank = undefined;
        }
        [sub, line] = parseNode(line);
        subs.push(sub);
      }
    }

    if (lastBlank !== undefined) {
      line = lastBlank;
    }

    return [subs, line];
  }

  let [subs, parsedLine] = parseSubs(0, -1);
  let line = parsedLine;

  for (; line < lines.length && lines[line] === '';) {
    subs.push(blankNode(line));
    line += 1;
  }

  if (line < lines.length) {
    throw new Error(`Parsing did not go to end of file. Ended at ${line} out of ${lines.length}`);
  }

  return topNode(subs);
}

function labelLines(tree: Node, labelRules: LabelRule[]) {
  function visitor(tree: Node) {
    if (isLine(tree)) {
      let rule = labelRules.find((rule) => rule.matches(tree.sourceLine));
      if (rule) {
        tree.label = rule.label;
      }
    }
  }
  visitTree(tree, visitor, 'bottomUp');
}

function labelVirtualInherited(tree: Node) {
  function visitor(tree: Node) {
    if (isVirtual(tree) && tree.label === undefined) {
      let subs = tree.subs.filter((sub) => !isBlank(sub));
      subs.length === 1 && (tree.label = subs[0].label);
    }
  }
  visitTree(tree, visitor, 'bottomUp');
}

function buildLabelRules(ruleMap: { [key: string]: RegExp | Matches }) {
  return Object.keys(ruleMap).map((key) => {
    let matches;
    const rule = ruleMap[key];
    if ('test' in rule) {
      matches = (sourceLine: string) => rule.test(sourceLine);
    } else {
      matches = rule;
    }

    return { matches: matches, label: key };
  });
}

function combineClosersAndOpeners(tree: Node): Node {
  let returnTree: Node = rebuildTree(tree, function rebuilder(tree: Node) {
    if (
      tree.subs.length === 0 ||
      tree.subs.findIndex((sub: Node) => sub.label === 'closer' || sub.label === 'opener') === -1
    ) {
      return tree;
    }

    let newSubs: Node[] = [];
    let lastNew: Exclude<Node, BlankNode> | undefined;
    for (let i = 0; i < tree.subs.length; i++) {
      const sub = tree.subs[i];
      const directOlderSibling = tree.subs[i - 1];

      if (sub.label === 'opener' && directOlderSibling !== undefined && isLine(directOlderSibling)) {
        directOlderSibling.subs.push(sub);
        sub.subs.forEach((nestedSub: Node) => directOlderSibling.subs.push(nestedSub));
        sub.subs = [];
      } else if (
        sub.label === 'closer' &&
        lastNew !== undefined &&
        (isLine(sub) || isVirtual(sub)) &&
        sub.indentation >= lastNew.indentation
      ) {
        let j = newSubs.length - 1;
        while (j > 0 && isBlank(newSubs[j])) j--;
        lastNew.subs.push(...newSubs.splice(j + 1));
        if (sub.subs.length > 0) {
          const firstNonVirtual = lastNew.subs.findIndex((nestedSub: Node) => nestedSub.label !== 'newVirtual');
          const subsToKeep = lastNew.subs.slice(0, firstNonVirtual);
          const subsToWrap = lastNew.subs.slice(firstNonVirtual);
          const wrappedSubs = subsToWrap.length > 0 ? [virtualNode(sub.indentation, subsToWrap, 'newVirtual')] : [];

          lastNew.subs = [...subsToKeep, ...wrappedSubs, sub];
        } else {
          lastNew.subs.push(sub);
        }
      } else {
        newSubs.push(sub);
        if (!isBlank(sub)) lastNew = sub;
      }
    }
    tree.subs = newSubs;
    return tree;
  });

  clearLabelsIf(tree, (arg: Label) => arg === 'newVirtual');
  return returnTree;
}

function groupBlocks(tree: Node, isDelimiter: (node: Node) => boolean = isBlank, label?: Label): Node {
  return rebuildTree(tree, function rebuilder(tree: Node): Node {
    if (tree.subs.length <= 1) return tree;
    const newSubs: Node[] = [];
    let nodesSinceLastFlush: Node[] = [];
    let currentBlockIndentation: number | undefined;
    let lastNodeWasDelimiter = false;

    function flushBlockIntoNewSubs(final: boolean = false) {
      if (currentBlockIndentation !== undefined && (newSubs.length > 0 || !final)) {
        let virtual = virtualNode(currentBlockIndentation, nodesSinceLastFlush, label);
        newSubs.push(virtual);
      } else {
        nodesSinceLastFlush.forEach((node) => newSubs.push(node));
      }
    }

    for (let i = 0; i < tree.subs.length; i++) {
      let sub: Node = tree.subs[i];
      let subIsDelimiter = isDelimiter(sub);

      if (!subIsDelimiter && lastNodeWasDelimiter) {
        flushBlockIntoNewSubs();
        nodesSinceLastFlush = [];
      }
      lastNodeWasDelimiter = subIsDelimiter;
      nodesSinceLastFlush.push(sub);

      if (!isBlank(sub)) {
        currentBlockIndentation = currentBlockIndentation != null ? currentBlockIndentation : sub.indentation;
      }
    }

    flushBlockIntoNewSubs(true);
    tree.subs = newSubs;
    return tree;
  });
}

function flattenVirtual(tree: Node): Node {
  return rebuildTree(tree, function rebuilder(tree: Node) {
    if (isVirtual(tree) && tree.label === undefined && tree.subs.length <= 1) {
      if (tree.subs.length === 0) {
        return undefined;
      } else {
        return tree.subs[0];
      }
    } else {
      if (tree.subs.length === 1 && isVirtual(tree.subs[0]) && tree.subs[0].label === undefined) {
        tree.subs = tree.subs[0].subs;
      }
      return tree;
    }
  });
}

function registerLanguageSpecificParser(language: string, parser: (source: TopNode) => Node) {
  LANGUAGE_SPECIFIC_PARSERS[language] = parser;
}

function parseTree(source: string, languageId?: string): Node {
  const raw = parseRaw(source);
  const languageSpecificParser = LANGUAGE_SPECIFIC_PARSERS[languageId ?? ''];
  if (languageSpecificParser) {
    return languageSpecificParser(raw);
  }
  labelLines(raw, genericLabelRules);
  return combineClosersAndOpeners(raw);
}

export {
  buildLabelRules,
  combineClosersAndOpeners,
  registerLanguageSpecificParser,
  flattenVirtual,
  parseTree,
  labelLines,
  labelVirtualInherited,
  groupBlocks,
};
