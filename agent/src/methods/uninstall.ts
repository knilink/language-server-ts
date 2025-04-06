import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../lib/src/context.ts';

import { Type } from '@sinclair/typebox';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { AgentInstallationManager } from '../installationManager.ts';

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
