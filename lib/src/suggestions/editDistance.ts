type LexemeId = number;
type Index = number;

function editDistance<T>(
  haystack: ArrayLike<T>,
  needle: ArrayLike<T>,
  compare: (h: T, n: T, i: Index, j: Index) => 0 | 1 = (h, n) => (h === n ? 0 : 1)
): { distance: number; startOffset: number; endOffset: number } {
  if (needle.length === 0 || haystack.length === 0) return { distance: needle.length, startOffset: 0, endOffset: 0 };
  let curRow = new Array(needle.length + 1).fill(0);
  let curStart = new Array(needle.length + 1).fill(0);
  let prevRow = new Array(haystack.length + 1).fill(0);
  let prevStart = new Array(haystack.length + 1).fill(0);
  let c = needle[0];
  for (let i = 0; i < haystack.length + 1; i++) {
    if (i === 0) {
      curRow[i] = 1;
    } else {
      curRow[i] = compare(haystack[i - 1], c, i - 1, 0);
    }
    curStart[i] = i > 0 ? i - 1 : 0;
  }
  for (let j = 1; j < needle.length; j++) {
    let swap = prevRow;
    prevRow = curRow;
    curRow = swap;
    swap = prevStart;
    prevStart = curStart;
    curStart = swap;
    c = needle[j];
    curRow[0] = j + 1;
    for (let i = 1; i < haystack.length + 1; i++) {
      const inserted = 1 + prevRow[i];
      const deleted = 1 + curRow[i - 1];
      const substituted = compare(haystack[i - 1], c, i - 1, j) + prevRow[i - 1];
      curRow[i] = Math.min(deleted, inserted, substituted);
      if (curRow[i] === substituted) {
        curStart[i] = prevStart[i - 1];
      } else if (curRow[i] === inserted) {
        curStart[i] = prevStart[i];
      } else {
        curStart[i] = curStart[i - 1];
      }
    }
  }
  let best = 0;
  for (let i = 0; i < haystack.length + 1; i++) {
    if (curRow[i] < curRow[best]) best = i;
  }
  return { distance: curRow[best], startOffset: curStart[best], endOffset: best };
}

type Dictionary = Map<string, number>;

function emptyLexDictionary(): Dictionary {
  return new Map<string, number>();
}

function reverseLexDictionary(d: Dictionary): string[] {
  let lookup = new Array(d.size);
  for (const [lexeme, idx] of d) lookup[idx] = lexeme;
  return lookup;
}

function* lexGeneratorWords(s: string) {
  let buffer = '';
  enum State {
    WORD,
    SPACE,
    OTHER,
  }
  let state = 0;
  for (const c of s) {
    let newState: State;
    if (new RegExp('(\\p{L}|\\p{Nd}|_)', 'u').test(c)) {
      newState = State.WORD;
    } else if (c === ' ') {
      newState = State.SPACE;
    } else {
      newState = State.OTHER;
    }
    if (newState === state && newState !== State.OTHER) {
      buffer += c;
    } else {
      if (buffer.length > 0) {
        yield buffer;
      }
      buffer = c;
      state = newState;
    }
  }
  if (buffer.length > 0) yield buffer;
}

function lexicalAnalyzer(
  s: string,
  d: Dictionary,
  lexGenerator: (s: string) => Iterable<string>,
  lexFilter: (lexeme: string) => boolean
): [[LexemeId, number][], Dictionary] {
  let lexed: [LexemeId, number][] = [];
  let offset = 0;
  for (const lexeme of lexGenerator(s)) {
    if (lexFilter(lexeme)) {
      let lexemeId = d.get(lexeme);
      if (lexemeId === undefined) {
        lexemeId = d.size;
        d.set(lexeme, lexemeId);
      }
      lexed.push([lexemeId, offset]);
    }
    offset += lexeme.length;
  }
  return [lexed, d];
}

function notSingleSpace(s: string) {
  return s !== ' ';
}

function lexEditDistance(
  haystack: string,
  needle: string,
  lexGenerator: (s: string) => Iterable<string> = lexGeneratorWords
) {
  let [haystackLexed, d] = lexicalAnalyzer(haystack, emptyLexDictionary(), lexGenerator, notSingleSpace);
  let [needleLexed, dBoth] = lexicalAnalyzer(needle, d, lexGenerator, notSingleSpace);
  if (needleLexed.length === 0 || haystackLexed.length === 0)
    return {
      lexDistance: needleLexed.length,
      startOffset: 0,
      endOffset: 0,
      haystackLexLength: haystackLexed.length,
      needleLexLength: needleLexed.length,
    };
  let lookupId = reverseLexDictionary(dBoth);
  let needleLexedLength = needleLexed.length;
  let needleFirst = lookupId[needleLexed[0][0]];
  let needleLast = lookupId[needleLexed[needleLexedLength - 1][0]];
  function compare(hLexId: LexemeId, nLexId: LexemeId, hIndex: Index, nIndex: Index): 0 | 1 {
    if (nIndex === 0 || nIndex === needleLexedLength - 1) {
      let haystackLexeme = lookupId[haystackLexed[hIndex][0]];

      return (nIndex == 0 && haystackLexeme.endsWith(needleFirst)) ||
        (nIndex == needleLexedLength - 1 && haystackLexeme.startsWith(needleLast))
        ? 0
        : 1;
    } else return hLexId === nLexId ? 0 : 1;
  }
  let alignment = editDistance(
      haystackLexed.map((x) => x[0]),
      needleLexed.map((x) => x[0]),
      compare
    ),
    startOffset = haystackLexed[alignment.startOffset][1],
    endOffset = alignment.endOffset < haystackLexed.length ? haystackLexed[alignment.endOffset][1] : haystack.length;
  return (
    endOffset > 0 && haystack[endOffset - 1] === ' ' && --endOffset,
    {
      lexDistance: alignment.distance,
      startOffset: startOffset,
      endOffset: endOffset,
      haystackLexLength: haystackLexed.length,
      needleLexLength: needleLexed.length,
    }
  );
}

export { lexEditDistance, editDistance };
