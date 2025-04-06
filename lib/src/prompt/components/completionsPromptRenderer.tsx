import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { ElidedBlock, Block } from './elision.ts';
import type { ITokenizer } from '../../../../prompt/src/tokenization/index.ts';
import type { CopilotJSXNodeSnapshot } from '../../../../prompt/src/components/virtualPrompt.ts';

import { AfterCursor, BeforeCursor, CurrentFile } from './currentFile.tsx';
import { WishlistElision, makePrompt } from './elision.ts';
import { Chunk } from '../../../../prompt/src/components/components.ts';
import { DEFAULT_MAX_PROMPT_LENGTH, DEFAULT_SUFFIX_PERCENT } from '../../../../prompt/src/prompt.ts';
import { getTokenizer } from '../../../../prompt/src/tokenization/tokenizer.ts';
import { TOKENS_RESERVED_FOR_SUFFIX_ENCODING } from '../../../../prompt/src/wishlist.ts';

interface BlockStatistic {
  componentPath: string;
  expectedTokens?: number;
  actualTokens?: number;
  updateDataTimeMs?: number;
}

interface PromptRendererOptions {
  delimiter?: string;
  tokenizer?: ITokenizer;
  promptTokenLimit: number;
  suffixPercent?: number;
}

interface SuccessRenderedPrompt {
  prefix: string;
  suffix: string;
  tokens: number;
  status: 'ok';
  metadata: {
    renderId: number;
    elisionTimeMs: number;
    renderTimeMs: number;
    componentStatistics: BlockStatistic[];
    updateDataTimeMs: number;
    status: 'ok';
  };
}

type RenderedPrompt = { status: 'cancelled' } | { status: 'error'; error: unknown } | SuccessRenderedPrompt;

type NodeVisitor = (
  node: CopilotJSXNodeSnapshot,
  scaledWeight: number,
  currentChunk?: CopilotJSXNodeSnapshot
) => Promise<boolean>;

function computeComponentStatistics(elidedBlocks: ElidedBlock[]): BlockStatistic[] {
  return elidedBlocks.map((block) => {
    const result: BlockStatistic = { componentPath: block.componentPath };

    if (block.tokens !== 0) {
      result.expectedTokens = block.tokens;
      result.actualTokens = block.elidedTokens;
    }

    if (block.nodeStatistics.updateDataTimeMs !== undefined) {
      result.updateDataTimeMs = block.nodeStatistics.updateDataTimeMs;
    }

    return result;
  });
}

class CompletionsPromptRenderer {
  renderId = 0;

  async render(
    snapshot: CopilotJSXNodeSnapshot,
    options: PromptRendererOptions,
    cancellationToken: CancellationToken | undefined
  ): Promise<RenderedPrompt> {
    const id = this.renderId++;
    const renderStart = performance.now();
    try {
      if (cancellationToken?.isCancellationRequested) {
        return { status: 'cancelled' };
      }
      const delimiter = options.delimiter ?? '';
      const tokenizer = options.tokenizer ?? getTokenizer();
      const { prefixBlocks, suffixBlock, componentStatistics } = await this.processSnapshot(snapshot, delimiter);
      const { prefixTokenLimit, suffixTokenLimit } = this.getPromptLimits(suffixBlock, options);
      const elisionStart = performance.now();
      const elisionStrategy = new WishlistElision(tokenizer);
      const [elidedSuffix, ...elidedPrefix] = elisionStrategy.elide(
        prefixBlocks,
        prefixTokenLimit,
        suffixBlock,
        suffixTokenLimit
      );
      const elisionEnd = performance.now();
      const prefix = makePrompt(elidedPrefix);
      const suffix = elidedSuffix.elidedValue;
      const tokens = tokenizer.tokenLength(prefix) + elidedSuffix.elidedTokens;
      componentStatistics.push(...computeComponentStatistics([...elidedPrefix, elidedSuffix]));
      return {
        prefix,
        suffix,
        tokens,
        status: 'ok',
        metadata: {
          renderId: id,
          elisionTimeMs: elisionEnd - elisionStart,
          renderTimeMs: performance.now() - renderStart,
          componentStatistics,
          updateDataTimeMs: componentStatistics.reduce((acc, component) => {
            return acc + (component.updateDataTimeMs ?? 0);
          }, 0),
          status: 'ok',
        },
      };
    } catch (e) {
      return { status: 'error', error: e };
    }
  }

  getPromptLimits(suffixBlock: Block, options: PromptRendererOptions) {
    const suffix = suffixBlock?.value ?? '';
    let availableTokens = options.promptTokenLimit ?? DEFAULT_MAX_PROMPT_LENGTH;
    const suffixPercent = options.suffixPercent ?? DEFAULT_SUFFIX_PERCENT;
    if (suffix.length == 0 || suffixPercent == 0) {
      return { prefixTokenLimit: availableTokens, suffixTokenLimit: 0 };
    }
    availableTokens = suffix.length > 0 ? availableTokens - TOKENS_RESERVED_FOR_SUFFIX_ENCODING : availableTokens;
    const suffixTokenLimit = Math.ceil(availableTokens * (suffixPercent / 100));
    return { prefixTokenLimit: availableTokens - suffixTokenLimit, suffixTokenLimit };
  }

  async processSnapshot(snapshot: CopilotJSXNodeSnapshot, delimiter: string) {
    const prefixBlocks: Block[] = [];
    const suffixBlocks: Block[] = [];
    const componentStatistics: BlockStatistic[] = [];
    let foundDocument = false;
    let beforeCursorFound = false;
    let afterCursorFound = false;

    await this.walkSnapshot(snapshot, async (node, weight, currentChunk) => {
      if (node === snapshot) {
        return true;
      }

      if (node.name === CurrentFile.name) {
        foundDocument = true;
      } else if (node.name === BeforeCursor.name) {
        beforeCursorFound = true;
      } else if (node.name === AfterCursor.name) {
        afterCursorFound = true;
      }

      if (node.statistics.updateDataTimeMs && node.statistics.updateDataTimeMs > 0) {
        componentStatistics.push({
          componentPath: node.path,
          updateDataTimeMs: node.statistics.updateDataTimeMs,
        });
      }

      if (node.value === undefined || node.value === '') {
        return true;
      }

      if (afterCursorFound) {
        suffixBlocks.push({
          value: node.value,
          weight,
          componentPath: node.path,
          nodeStatistics: node.statistics,
          chunk: currentChunk ? currentChunk.path : undefined,
        });
      } else {
        const nodeValueWithDelimiter = node.value.endsWith(delimiter) ? node.value : node.value + delimiter;
        const value = beforeCursorFound ? node.value : nodeValueWithDelimiter;
        prefixBlocks.push({
          value,
          weight,
          componentPath: node.path,
          nodeStatistics: node.statistics,
          chunk: currentChunk ? currentChunk.path : undefined,
        });
      }
      return true;
    });

    if (!foundDocument) {
      throw new Error(`Node of type ${CurrentFile.name} not found`);
    }
    if (suffixBlocks.length > 1) {
      throw new Error('Only one suffix is allowed');
    }
    const suffixBlock = suffixBlocks[0];
    return { prefixBlocks, suffixBlock, componentStatistics };
  }

  async walkSnapshot(node: CopilotJSXNodeSnapshot, visitor: NodeVisitor) {
    await this.walkSnapshotNode(node, visitor, 1, undefined);
  }

  async walkSnapshotNode(
    node: CopilotJSXNodeSnapshot,
    visitor: NodeVisitor,
    parentWeight: number,
    chunk?: CopilotJSXNodeSnapshot
  ) {
    const weight = node.props?.weight ?? 1;
    const scaledWeight = (typeof weight == 'number' ? Math.max(0, Math.min(1, weight)) : 1) * parentWeight;
    const currentChunk = node.name === Chunk.name ? node : chunk;
    if (await visitor(node, scaledWeight, currentChunk)) {
      for (const child of node.children ?? []) await this.walkSnapshotNode(child, visitor, scaledWeight, currentChunk);
    }
  }
}

export { CompletionsPromptRenderer };

export type { RenderedPrompt, SuccessRenderedPrompt };
