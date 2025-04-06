import type { DocumentUri } from 'vscode-languageserver-types';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { DocumentValidationResult } from '../../lib/src/util/documentEvaluation.ts';
import type { Context } from '../../lib/src/context.ts';
import type { CopilotTextDocument } from '../../lib/src/textDocument.ts';

import { ResponseError } from '../../node_modules/vscode-languageserver/lib/node/main.js';
import { verifyAuthenticated } from './auth/authDecorator.ts';
import { ErrorCode } from './rpc.ts';
import { logger } from './service.ts';
import { StatusReporter } from '../../lib/src/progress.ts';
import { TelemetryData, telemetry } from '../../lib/src/telemetry.ts';
import { TextDocumentManager } from '../../lib/src/textDocumentManager.ts';

async function getTextDocumentChecked(ctx: Context, uri: DocumentUri): Promise<DocumentValidationResult> {
  return await ctx.get(TextDocumentManager).getTextDocumentWithValidation({ uri });
}

function telemetryVersionMismatch(
  ctx: Context,
  textDocument: CopilotTextDocument,
  requestedDocumentVersion: number
): void {
  const data = TelemetryData.createAndMarkAsIssued({
    languageId: String(textDocument.languageId),
    requestedDocumentVersion: String(requestedDocumentVersion),
    actualDocumentVersion: String(textDocument.version),
  });
  return telemetry(ctx, 'getCompletions.docVersionMismatch', data);
}

async function getOpenTextDocumentChecked(
  ctx: Context,
  doc: {
    uri: DocumentUri;
    // optional ./methods/copilotPanelCompletion.ts
    version?: number;
  },
  token: CancellationToken
): Promise<CopilotTextDocument> {
  const promise = ctx.get(TextDocumentManager).getOpenTextDocumentWithValidation(doc);
  await verifyAuthenticated(ctx, token);
  let result = await promise;
  if (result.status === 'notfound') {
    throw new ResponseError(ErrorCode.InvalidParams, result.message);
  }
  if (result.status === 'invalid') {
    ctx.get(StatusReporter).setInactive(result.reason);
    throw new ResponseError(ErrorCode.CopilotNotAvailable, result.reason);
  }
  if (doc.version !== undefined && result.document.version !== doc.version) {
    if (!token.isCancellationRequested) {
      telemetryVersionMismatch(ctx, result.document, doc.version);
      logger.debug(
        ctx,
        `Requested document version was ${doc.version} but actual document version was ${result.document.version}.`
      );
    }
    throw new ResponseError(ErrorCode.ContentModified, 'Document Version Mismatch');
  }
  return result.document;
}

export { getOpenTextDocumentChecked, getTextDocumentChecked };
