import type { Context } from '../context.ts';
import type { CopilotTextDocument } from '../textDocument.ts';

import { CopilotContentExclusionManager } from '../contentExclusion/contentExclusionManager.ts';

type ValidDocumentResult = { status: 'valid'; document: CopilotTextDocument };

type DocumentValidationResult =
  | ValidDocumentResult
  | { status: 'invalid'; reason: string }
  | { status: 'notfound'; message: string };

async function isDocumentValid(ctx: Context, document: CopilotTextDocument): Promise<DocumentValidationResult> {
  const rcmResult = await ctx.get(CopilotContentExclusionManager).evaluate(document.uri, document.getText());

  if (rcmResult.isBlocked) {
    return {
      status: 'invalid',
      reason: rcmResult.message ?? 'Document is blocked by repository policy',
    };
  }

  return { status: 'valid', document: document };
}

export { isDocumentValid, DocumentValidationResult, ValidDocumentResult };
