import { URI } from 'vscode-uri';
import { DocumentUri } from 'vscode-languageserver-types';
import { CancellationToken, ResponseError } from 'vscode-languageserver/node.js';
import { verifyAuthenticated } from './auth/authDecorator.ts';
import { logger } from './service.ts';
import { StatusReporter } from '../../lib/src/progress.ts';
import { TelemetryData, telemetry } from '../../lib/src/telemetry.ts';

import { type DocumentValidationResult } from '../../lib/src/util/documentEvaluation.ts';

import { Context } from '../../lib/src/context.ts';
import { TextDocumentManager } from '../../lib/src/textDocumentManager.ts';
import { TextDocument } from '../../lib/src/textDocument.ts';
// import '../agent/src/rpc.ts';

async function getTextDocumentChecked(ctx: Context, uri: DocumentUri): Promise<DocumentValidationResult> {
  return await ctx.get(TextDocumentManager).getTextDocumentWithValidation({ uri });
}

async function telemetryVersionMismatch(ctx: Context, textDocument: TextDocument, requestedDocumentVersion: number) {
  let data = TelemetryData.createAndMarkAsIssued({
    languageId: String(textDocument.languageId),
    requestedDocumentVersion: String(requestedDocumentVersion),
    actualDocumentVersion: String(textDocument.version),
  });
  telemetry(ctx, 'getCompletions.docVersionMismatch', data);
}

async function getOpenTextDocumentChecked(
  ctx: Context,
  doc: {
    uri: DocumentUri;
    // optional ./methods/copilotPanelCompletion.ts
    version?: number;
  },
  token: CancellationToken
): Promise<TextDocument> {
  const promise = ctx.get(TextDocumentManager).getOpenTextDocumentWithValidation(doc);
  await verifyAuthenticated(ctx, token);
  let result = await promise;
  if (result.status === 'notfound') throw new ResponseError(-32602, result.message);
  if (result.status === 'invalid') {
    ctx.get(StatusReporter).setInactive(result.reason);
    throw new ResponseError(1002, result.reason);
  }
  if (doc.version !== undefined && result.document.version !== doc.version) {
    if (!token.isCancellationRequested) {
      telemetryVersionMismatch(ctx, result.document, doc.version);
      logger.debug(
        ctx,
        `Requested document version was ${doc.version} but actual document version was ${result.document.version}.`
      );
    }
    throw new ResponseError(-32801, 'Document Version Mismatch');
  }
  return result.document;
}

export { getOpenTextDocumentChecked, getTextDocumentChecked };
