import { Document, LanguageId, Snippet } from '../types';
import { } from './snippets';

function splitIntoWords(a: string) {
  return a.split(/[^a-zA-Z0-9]/).filter((x) => x.length > 0);
}

const ENGLISH_STOPS = new Set(
  'we,our,you,it,its,they,them,their,this,that,these,those,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,can,don,t,s,will,would,should,what,which,who,when,where,why,how,a,an,the,and,or,not,no,but,because,as,until,again,further,then,once,here,there,all,any,both,each,few,more,most,other,some,such,above,below,to,during,before,after,of,at,by,about,between,into,through,from,up,down,in,out,on,off,over,under,only,own,same,so,than,too,very,just,now'.split(
    ','
  )
);

const GENERIC_STOPS = new Set([
  ...'if,then,else,for,while,with,def,function,return,TODO,import,try,catch,raise,finally,repeat,switch,case,match,assert,continue,break,const,class,enum,struct,static,new,super,this,var'.split(
    ','
  ),
  ...ENGLISH_STOPS,
]);

const SPECIFIC_STOPS = new Map<LanguageId, Set<string>>([]);

class FifoCache<V> {
  keys: string[] = [];
  cache: { [key: string]: V } = {};
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  put(key: string, value: V) {
    this.cache[key] = value;
    if (this.keys.length > this.size) {
      this.keys.push(key);
      let leavingKey = this.keys.shift() ?? '';
      delete this.cache[leavingKey];
    }
  }
  get(key: string) {
    return this.cache[key];
  }
}

class Tokenizer {
  stopsForLanguage: Set<string>;
  constructor(doc: Document) {
    this.stopsForLanguage = SPECIFIC_STOPS.get(doc.languageId) ?? GENERIC_STOPS;
  }
  tokenize(a: string) {
    return new Set(splitIntoWords(a).filter((x) => !this.stopsForLanguage.has(x)));
  }
}

type TokenWindow = Set<string>;
const WINDOWED_TOKEN_SET_CACHE = new FifoCache<TokenWindow[]>(20);

abstract class WindowedMatcher {
  private tokenizer: Tokenizer;
  private referenceTokensCache?: Set<string>;
  constructor(
    private referenceDoc: Document,
    private cacheReferenceTokens: boolean
  ) {
    this.tokenizer = new Tokenizer(referenceDoc);
  }

  get referenceTokens(): Set<string> {
    if (this.cacheReferenceTokens && this.referenceTokensCache) {
      return this.referenceTokensCache;
    }

    const tokens = this.tokenizer.tokenize(this._getCursorContextInfo(this.referenceDoc).context);
    if (this.cacheReferenceTokens) {
      this.referenceTokensCache = tokens;
    }

    return tokens;
  }

  private sortScoredSnippets<T extends { score: number }>(
    snippets: T[],
    sortOption: 'ascending' | 'descending' = 'descending'
  ): T[] {
    if (sortOption === 'ascending') {
      snippets.sort((a, b) => (a.score > b.score ? 1 : -1));
    } else if (sortOption === 'descending') {
      snippets.sort((a, b) => (a.score > b.score ? -1 : 1));
    }
    return snippets;
  }

  private retrieveAllSnippets(
    objectDoc: Document,
    sortOption: 'ascending' | 'descending' = 'descending'
  ): { score: number; startLine: number; endLine: number }[] {
    const snippets: { score: number; startLine: number; endLine: number }[] = [];
    if (objectDoc.source.length === 0 || this.referenceTokens.size === 0) return snippets;

    const lines = objectDoc.source.split('\n');
    const key = `${this.id()}:${objectDoc.source}`;
    let tokensInWindows: TokenWindow[] = WINDOWED_TOKEN_SET_CACHE.get(key) || [];
    const needToComputeTokens = tokensInWindows.length === 0;
    const tokenizedLines = needToComputeTokens ? lines.map((line) => this.tokenizer.tokenize(line)) : [];

    for (const [index, [startLine, endLine]] of this.getWindowsDelineations(lines).entries()) {
      if (needToComputeTokens) {
        const tokensInWindow: TokenWindow = new Set<string>();
        tokenizedLines.slice(startLine, endLine).forEach((lineTokens) => {
          lineTokens.forEach((token) => tokensInWindow.add(token));
        });
        tokensInWindows.push(tokensInWindow);
      }

      const score = this.similarityScore(tokensInWindows[index], this.referenceTokens);

      snippets.push({ score, startLine, endLine });
    }

    if (needToComputeTokens) {
      WINDOWED_TOKEN_SET_CACHE.put(key, tokensInWindows);
    }

    return this.sortScoredSnippets(snippets, sortOption);
  }

  async findMatches(objectDoc: Document) {
    const snippet = await this.findBestMatch(objectDoc);
    return snippet ? [snippet] : [];
  }

  async findBestMatch(objectDoc: Document): Promise<Omit<Snippet, 'relativePath'> | undefined> {
    if (objectDoc.source.length === 0 || this.referenceTokens.size === 0) return;

    const lines = objectDoc.source.split('\n');
    const snippets = this.retrieveAllSnippets(objectDoc, 'descending');

    if (snippets.length === 0 || snippets[0].score === 0) return;

    return {
      snippet: lines.slice(snippets[0].startLine, snippets[0].endLine).join('\n'),
      semantics: 'snippet',
      provider: 'similar-files',
      ...snippets[0],
    };
  }

  abstract _getCursorContextInfo(referenceDoc: Document): { context: string };

  abstract getWindowsDelineations(lines: string[]): [number, number][];

  abstract similarityScore(tokensInWindow: Set<unknown>, referenceTokens: Set<unknown>): number;

  abstract id(): string;
}

export { WindowedMatcher };
