import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from "../cancellation.ts";

import { Context } from "../../../lib/src/context.ts";
import { addMethodHandlerValidation } from "../schemaValidation.ts";
import { AgentInstallationManager } from "../installationManager.ts";

const Params = Type.Object({});

async function handleUninstallChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[string, null]> {
  await new AgentInstallationManager().uninstall(ctx);
  return ['OK', null];
}

const handleUninstall = addMethodHandlerValidation(Params, handleUninstallChecked);

export { handleUninstall };
