import { CurrentDocument, OpenDocument, LanguageId, Snippet } from '../types.ts';
import {} from './snippets.ts';

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
  constructor(doc: CurrentDocument) {
    this.stopsForLanguage = SPECIFIC_STOPS.get(doc.languageId) ?? GENERIC_STOPS;
  }
  tokenize(a: string): Set<string> {
    return new Set(splitIntoWords(a).filter((x) => !this.stopsForLanguage.has(x)));
  }
}

type TokenWindow = Set<string>;
const WINDOWED_TOKEN_SET_CACHE = new FifoCache<TokenWindow[]>(20);

abstract class WindowedMatcher {
  readonly tokenizer: Tokenizer;
  referenceTokensCache?: Set<string>;
  constructor(readonly referenceDoc: CurrentDocument) {
    this.tokenizer = new Tokenizer(referenceDoc);
  }

  get referenceTokens(): Promise<Set<string>> {
    return this.createReferenceTokens();
  }

  async createReferenceTokens(): Promise<Set<string>> {
    this.referenceTokensCache ??= this.tokenizer.tokenize(this._getCursorContextInfo(this.referenceDoc).context);
    return this.referenceTokensCache;
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

  async retrieveAllSnippets(
    objectDoc: OpenDocument,
    sortOption: 'ascending' | 'descending' = 'descending'
  ): Promise<{ score: number; startLine: number; endLine: number }[]> {
    const snippets: { score: number; startLine: number; endLine: number }[] = [];
    if (objectDoc.source.length === 0 || (await this.referenceTokens).size === 0) return snippets;

    const lines = objectDoc.source.split('\n');
    const key = `${this.id()}:${objectDoc.source}`;
    let tokensInWindows: TokenWindow[] = WINDOWED_TOKEN_SET_CACHE.get(key) || [];
    const needToComputeTokens = tokensInWindows.length === 0;
    const tokenizedLines = needToComputeTokens ? lines.map((l) => this.tokenizer.tokenize(l)) : [];

    for (const [index, [startLine, endLine]] of this.getWindowsDelineations(lines).entries()) {
      if (needToComputeTokens) {
        const tokensInWindow: TokenWindow = new Set<string>();
        tokenizedLines.slice(startLine, endLine).forEach((x) => {
          x.forEach((s) => tokensInWindow.add(s));
        });
        tokensInWindows.push(tokensInWindow);
      }

      const score = this.similarityScore(tokensInWindows[index], await this.referenceTokens);
      if (snippets.length && startLine > 0 && snippets[snippets.length - 1].endLine > startLine) {
        if (snippets[snippets.length - 1].score < score) {
          snippets[snippets.length - 1].score = score;
          snippets[snippets.length - 1].startLine = startLine;
          snippets[snippets.length - 1].endLine = endLine;
        }
        continue;
      }

      snippets.push({ score, startLine, endLine });
    }

    if (needToComputeTokens) {
      WINDOWED_TOKEN_SET_CACHE.put(key, tokensInWindows);
    }

    return this.sortScoredSnippets(snippets, sortOption);
  }

  async findMatches(objectDoc: OpenDocument, maxSnippetsPerFile: number): Promise<Snippet[]> {
    return this.findBestMatch(objectDoc, maxSnippetsPerFile);
  }

  async findBestMatch(objectDoc: OpenDocument, maxSnippetsPerFile: number): Promise<Snippet[]> {
    if (objectDoc.source.length === 0 || (await this.referenceTokens).size === 0) return [];

    const lines = objectDoc.source.split('\n');
    const snippets = await this.retrieveAllSnippets(objectDoc, 'descending');

    if (snippets.length === 0) return [];
    const bestSnippets: Snippet[] = [];
    for (let i = 0; i < snippets.length && i < maxSnippetsPerFile; i++)
      if (snippets[i].score !== 0) {
        const snippetCode = lines.slice(snippets[i].startLine, snippets[i].endLine).join(`\n`);
        bestSnippets.push({ snippet: snippetCode, semantics: 'snippet', provider: 'similar-files', ...snippets[i] });
      }
    return bestSnippets;
  }

  abstract _getCursorContextInfo(referenceDoc: CurrentDocument): { context: string };

  abstract getWindowsDelineations(lines: string[]): [number, number][];

  abstract similarityScore(tokensInWindow: Set<unknown>, referenceTokens: Set<unknown>): number;

  abstract id(): string;
}

export { WindowedMatcher };
