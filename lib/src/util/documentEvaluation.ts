import { Context } from "../context.ts";
import { TextDocument } from "../textDocument.ts";

import { CopilotContentExclusionManager } from "../contentExclusion/contentExclusionManager.ts";

function isDocumentTooLarge(document: TextDocument): boolean {
  try {
    document.getText();
    return false;
  } catch (e) {
    if (e instanceof RangeError) return true;
    throw e;
  }
}

type ValidDocumentResult = { status: 'valid'; document: TextDocument };

type DocumentValidationResult =
  | ValidDocumentResult
  | { status: 'invalid'; reason: string }
  | { status: 'notfound'; message: string };

async function isDocumentValid(ctx: Context, document: TextDocument): Promise<DocumentValidationResult> {
  const copilotContentExclusionManager = ctx.get(CopilotContentExclusionManager);

  if (isDocumentTooLarge(document)) return { status: 'invalid', reason: 'Document is too large' };

  let rcmResult = await copilotContentExclusionManager.evaluate(document.vscodeUri, document.getText());

  if (rcmResult.isBlocked) {
    return {
      status: 'invalid',
      reason: rcmResult.message ?? 'Document is blocked by repository policy',
    };
  }

  return { status: 'valid', document: document };
}

export { isDocumentTooLarge, isDocumentValid, DocumentValidationResult, ValidDocumentResult };
