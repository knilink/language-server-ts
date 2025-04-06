import type { CopilotJSXNodeStatistics } from '../../../../prompt/src/components/virtualPrompt.ts';
import type { ITokenizer } from '../../../../prompt/src/lib.ts';

interface Block {
  value: string;
  weight: number;
  componentPath: string;
  nodeStatistics: CopilotJSXNodeStatistics;
  chunk?: string;
}

// computeComponentStatistics ./completionsPromptRenderer.tsx
interface ElidedBlock extends Block {
  tokens: number;
  elidedTokens: number;
  elidedValue: string;
}

interface ElidablePrefixBlock extends Block {
  tokens: number;
  markedForRemoval: boolean;
}

interface ElidablePrefixBlockWithIndex extends ElidablePrefixBlock {
  originalIndex: number;
}

function makePrompt(elidedBlocks: ElidedBlock[]): string {
  return elidedBlocks.map((block) => block.elidedValue).join('');
}

class WishlistElision {
  constructor(readonly tokenizer: ITokenizer) {}

  elide(
    prefixBlocks: Block[],
    prefixTokenLimit: number,
    suffixBlock?: Block,
    suffixTokenLimit: number = 0
  ): ElidedBlock[] {
    if (prefixTokenLimit <= 0) {
      throw new Error('Prefix limit must be greater than 0');
    }

    const weightedSuffixBlock = suffixBlock ?? { componentPath: '', value: '', weight: 1, nodeStatistics: {} };
    const [elidablePrefixBlocks, maxPrefixTokens] = this.preparePrefixBlocks(prefixBlocks);
    const { elidedSuffix, adjustedPrefixTokenLimit } = this.elideSuffix(
      weightedSuffixBlock,
      suffixTokenLimit,
      prefixTokenLimit,
      maxPrefixTokens
    );
    const elidedPrefix = this.elidePrefix(elidablePrefixBlocks, adjustedPrefixTokenLimit, maxPrefixTokens);
    return [elidedSuffix, ...elidedPrefix];
  }

  preparePrefixBlocks(blocks: Block[]): [ElidablePrefixBlockWithIndex[], number] {
    let maxPrefixTokens = 0;
    const componentPaths = new Set<string>();
    return [
      blocks.map((block, index) => {
        const tokens = this.tokenizer.tokenLength(block.value);
        maxPrefixTokens += tokens;
        const componentPath = block.componentPath;
        if (componentPaths.has(componentPath)) {
          throw new Error(`Duplicate component path in prefix blocks: ${componentPath}`);
        }
        componentPaths.add(componentPath);
        return { ...block, tokens, markedForRemoval: false, originalIndex: index };
      }),
      maxPrefixTokens,
    ];
  }

  elideSuffix(
    weightedSuffixBlock: Block,
    suffixTokenLimit: number,
    prefixTokenLimit: number,
    maxPrefixTokens: number
  ): {
    elidedSuffix: ElidedBlock;
    adjustedPrefixTokenLimit: number;
  } {
    const suffix = weightedSuffixBlock.value;
    if (suffix.length === 0 || suffixTokenLimit <= 0) {
      return {
        elidedSuffix: { ...weightedSuffixBlock, tokens: 0, elidedValue: '', elidedTokens: 0 },
        adjustedPrefixTokenLimit: prefixTokenLimit + Math.max(0, suffixTokenLimit),
      };
    }

    if (maxPrefixTokens < prefixTokenLimit) {
      suffixTokenLimit += prefixTokenLimit - maxPrefixTokens;
      prefixTokenLimit = maxPrefixTokens;
    }

    const shortenedSuffix = this.tokenizer.takeFirstTokens(suffix, suffixTokenLimit);
    return {
      elidedSuffix: {
        ...weightedSuffixBlock,
        value: suffix,
        tokens: this.tokenizer.tokenLength(suffix),
        elidedValue: shortenedSuffix.text,
        elidedTokens: shortenedSuffix.tokens.length,
      },
      adjustedPrefixTokenLimit: prefixTokenLimit + Math.max(0, suffixTokenLimit - shortenedSuffix.tokens.length),
    };
  }

  elidePrefix(
    elidablePrefixBlocks: ElidablePrefixBlockWithIndex[],
    tokenLimit: number,
    maxPrefixTokens: number
  ): ElidedBlock[] {
    const prefixBlocks = this.removeLowWeightPrefixBlocks(elidablePrefixBlocks, tokenLimit, maxPrefixTokens);
    const linesWithComponentPath = prefixBlocks
      .filter((block) => !block.markedForRemoval)
      .flatMap((block) =>
        block.value.split(/([^\n]*\n+)/).map((line) => ({ line, componentPath: block.componentPath }))
      )
      .filter((l) => l.line !== '');

    if (linesWithComponentPath.length === 0) {
      return [];
    }

    const [trimmedLines, prefixTokens] = this.trimPrefixLinesToFit(linesWithComponentPath, tokenLimit);
    let currentPrefixTokens = prefixTokens;

    return prefixBlocks.map((block) => {
      if (block.markedForRemoval) {
        if (currentPrefixTokens + block.tokens <= tokenLimit && !block.chunk) {
          currentPrefixTokens += block.tokens;
          return { ...block, elidedValue: block.value, elidedTokens: block.tokens };
        }
        return { ...block, elidedValue: '', elidedTokens: 0 };
      }

      const elidedValue = trimmedLines
        .filter((l) => l.componentPath === block.componentPath && l.line !== '')
        .map((l) => l.line)
        .join('');

      let elidedTokens = block.tokens;
      if (elidedValue !== block.value) {
        elidedTokens = elidedValue !== '' ? this.tokenizer.tokenLength(elidedValue) : 0;
      }

      return { ...block, elidedValue, elidedTokens };
    });
  }

  removeLowWeightPrefixBlocks(
    elidablePrefixBlocks: ElidablePrefixBlockWithIndex[],
    tokenLimit: number,
    maxPrefixTokens: number
  ): ElidablePrefixBlock[] {
    let totalPrefixTokens = maxPrefixTokens;
    elidablePrefixBlocks.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));
    for (const block of elidablePrefixBlocks) {
      if (totalPrefixTokens <= tokenLimit) {
        break;
      }
      if (block.weight !== 1 && !(block.chunk && block.markedForRemoval)) {
        if (block.chunk) {
          for (const relatedBlock of elidablePrefixBlocks) {
            if (relatedBlock.chunk === block.chunk && !relatedBlock.markedForRemoval) {
              relatedBlock.markedForRemoval = true;
              totalPrefixTokens -= relatedBlock.tokens;
            }
          }
        } else {
          block.markedForRemoval = true;
          totalPrefixTokens -= block.tokens;
        }
      }
    }
    return elidablePrefixBlocks
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .map(({ originalIndex, ...rest }) => rest);
  }

  trimPrefixLinesToFit(
    linesWithComponentPath: { line: string; componentPath: string }[],
    tokenLimit: number
  ): [{ line: string; componentPath: string }[], number] {
    let currentPrefixTokens = 0;
    const fittingLines: Array<{ line: string; componentPath: string }> = [];
    for (let i = linesWithComponentPath.length - 1; i >= 0; i--) {
      const currentLine = linesWithComponentPath[i];
      const text = currentLine.line;
      const lineTokens = this.tokenizer.tokenLength(text);
      if (currentPrefixTokens + lineTokens <= tokenLimit) {
        fittingLines.unshift(currentLine);
        currentPrefixTokens += lineTokens;
      } else {
        break;
      }
    }
    if (fittingLines.length === 0) {
      const lastLine = linesWithComponentPath[linesWithComponentPath.length - 1];
      if (lastLine?.line.length > 0) {
        const prompt = this.tokenizer.takeLastTokens(lastLine.line, tokenLimit);
        fittingLines.push({ line: prompt.text, componentPath: lastLine.componentPath });
        return [fittingLines, prompt.tokens.length];
      }
      throw new Error(`Cannot fit prefix within limit of ${tokenLimit} tokens`);
    }
    return [fittingLines, currentPrefixTokens];
  }
}

export { WishlistElision, makePrompt };

export type { Block, ElidedBlock };
