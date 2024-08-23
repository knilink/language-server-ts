import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../cancellation';

import { Context } from '../../../lib/src/context';
import { addMethodHandlerValidation } from '../schemaValidation';
import { AgentInstallationManager } from '../installationManager';

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
