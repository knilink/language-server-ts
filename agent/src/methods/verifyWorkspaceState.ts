import { Type, type Static } from '@sinclair/typebox';

import { type CancellationToken } from "../cancellation.ts";
import { type Context } from "../../../lib/src/context.ts";

import { TextDocumentManager } from "../../../lib/src/textDocumentManager.ts";
import { addMethodHandlerValidation } from "../schemaValidation.ts";

const Params = Type.Object({});

async function handleVerifyWorkspaceStateChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[Awaited<ReturnType<TextDocumentManager['getWorkspaceFolders']>>, null]> {
  return [ctx.get(TextDocumentManager).getWorkspaceFolders(), null];
}

const handleVerifyWorkspaceState = addMethodHandlerValidation(Params, handleVerifyWorkspaceStateChecked);

export { handleVerifyWorkspaceState };
