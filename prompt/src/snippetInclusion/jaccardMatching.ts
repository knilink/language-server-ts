import { Document } from '../types';
import { getCursorContext } from './cursorContext';
import { getBasicWindowDelineations } from './windowDelineations';
import { WindowedMatcher } from './selectRelevance';

// function computeScore(a: Set<unknown>, b: Set<unknown>): number {
//   const intersection = new Set<unknown>();
//   a.forEach((x) => {
//     if (b.has(x)) {
//       intersection.add(x);
//     }
//   });
//   return intersection.size / (a.size + b.size - intersection.size);
// }

function computeScore(a: Set<unknown>, b: Set<unknown>): number {
  let intersectionSize = 0;
  for (const x of a) {
    if (b.has(x)) {
      intersectionSize++;
    }
  }
  return intersectionSize / (a.size + b.size - intersectionSize);
}

class FixedWindowSizeJaccardMatcher extends WindowedMatcher {
  windowLength: number;

  static FACTORY(windowLength: number, cacheReferenceTokens: boolean) {
    return {
      to(referenceDoc: Document): FixedWindowSizeJaccardMatcher {
        return new FixedWindowSizeJaccardMatcher(referenceDoc, windowLength, cacheReferenceTokens);
      },
    };
  }

  constructor(referenceDoc: Document, windowLength: number, cacheReferenceTokens: boolean) {
    super(referenceDoc, cacheReferenceTokens);
    this.windowLength = windowLength;
  }

  id(): string {
    return `fixed:${this.windowLength}`;
  }

  getWindowsDelineations(lines: string[]): [number, number][] {
    return getBasicWindowDelineations(this.windowLength, lines);
  }

  _getCursorContextInfo(referenceDoc: Document) {
    return getCursorContext(referenceDoc, { maxLineCount: this.windowLength });
  }

  similarityScore(a: Set<unknown>, b: Set<unknown>): number {
    return computeScore(a, b);
  }
}

export { FixedWindowSizeJaccardMatcher };
