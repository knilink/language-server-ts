import { URI } from 'vscode-uri';
import { type DocumentValidationResult } from '../../lib/src/util/documentEvaluation.ts';

import { Context } from '../../lib/src/context.ts';
import { TextDocument } from '../../lib/src/textDocument.ts';
import { TextDocumentManager } from '../../lib/src/textDocumentManager.ts';

function parseUri(uri: string): URI {
  try {
    const match = uri.match(/^((?:[^:/?#]+?:)?\/\/)(\/\/.*)$/);
    if (match) {
      return URI.parse(match[1] + match[2].replaceAll('/', '%2F')); // encodeURIComponent
    } else {
      return URI.parse(uri);
    }
  } catch (e: unknown) {
    const wrapped = new Error(`Could not parse < ${uri}> `);
    (wrapped as any).cause = e;
    throw wrapped;
  }
}

function cloneTextDocumentResult(result: DocumentValidationResult): DocumentValidationResult {
  if (result.status === 'valid') {
    return {
      status: 'valid',
      document: TextDocument.create(
        result.document.uri,
        result.document.languageId,
        result.document.version,
        result.document.getText()
      ),
    };
  } else {
    return result;
  }
}

async function getTextDocumentChecked(ctx: Context, uri: string): Promise<DocumentValidationResult> {
  const result = await ctx.get(TextDocumentManager).getTextDocumentWithValidation(parseUri(uri));
  return cloneTextDocumentResult(result);
}

function getOpenTextDocumentChecked(ctx: Context, uri: string): PromiseLike<DocumentValidationResult> {
  const promise = ctx.get(TextDocumentManager).getOpenTextDocumentWithValidation(parseUri(uri));

  return {
    then: async (onFulfilled, onRejected?) => promise.then(cloneTextDocumentResult).then(onFulfilled, onRejected),
  };
}

export { getOpenTextDocumentChecked, getTextDocumentChecked, parseUri, cloneTextDocumentResult };
