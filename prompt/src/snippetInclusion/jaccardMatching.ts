import { CurrentDocument } from '../types.ts';
import { getCursorContext } from './cursorContext.ts';
import { getBasicWindowDelineations } from './windowDelineations.ts';
import { WindowedMatcher } from './selectRelevance.ts';

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

  static FACTORY(windowLength: number) {
    return {
      to(referenceDoc: CurrentDocument): FixedWindowSizeJaccardMatcher {
        return new FixedWindowSizeJaccardMatcher(referenceDoc, windowLength);
      },
    };
  }

  constructor(referenceDoc: CurrentDocument, windowLength: number) {
    super(referenceDoc);
    this.windowLength = windowLength;
  }

  id(): string {
    return `fixed:${this.windowLength}`;
  }

  getWindowsDelineations(lines: string[]): [number, number][] {
    return getBasicWindowDelineations(this.windowLength, lines);
  }

  _getCursorContextInfo(referenceDoc: CurrentDocument) {
    return getCursorContext(referenceDoc, { maxLineCount: this.windowLength });
  }

  similarityScore(a: Set<unknown>, b: Set<unknown>): number {
    return computeScore(a, b);
  }
}

export { FixedWindowSizeJaccardMatcher };
