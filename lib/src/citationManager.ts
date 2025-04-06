import type { Range } from 'vscode-languageserver-types';
import type { Context } from './context.ts';

interface Citation {
  inDocumentUri: string;
  offsetStart: number;
  offsetEnd: number;
  version?: number;
  location?: Range;
  // optional ./postInsertion.ts doc?.getText(...)
  matchingText?: string;

  // required citation.details.map(...) ../../agent/src/citationManager.ts
  details: {
    // ../../agent/src/citationManager.ts
    license: string;
    // ../../agent/src/citationManager.ts
    url: string;
  }[];
}

abstract class CitationManager {
  abstract handleIPCodeCitation(ctx: Context, citation: Citation): Promise<void>;
}

class NoOpCitationManager extends CitationManager {
  async handleIPCodeCitation(ctx: Context, citation: Citation): Promise<void> {}
}

export { CitationManager, NoOpCitationManager, Citation };
