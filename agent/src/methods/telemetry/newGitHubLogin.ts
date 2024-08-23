import { Type, type Static } from '@sinclair/typebox';
import { type Context } from '../../../../lib/src/context';
import { type CancellationToken } from '../../cancellation';

import { telemetryNewGitHubLogin } from '../../../../lib/src/telemetry/auth';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({
  authSource: Type.Union([Type.Literal('toast'), Type.Literal('goldbar'), Type.Literal('menu')]),
  authType: Type.Union([Type.Literal('editorAuth'), Type.Literal('deviceFlow')]),
});

async function handleTelemetryNewGitHubLoginChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  await telemetryNewGitHubLogin(ctx, params.authSource, params.authType);
  return ['OK', null];
}

const handleTelemetryNewGitHubLogin = addMethodHandlerValidation(Params, handleTelemetryNewGitHubLoginChecked);

export { handleTelemetryNewGitHubLogin };
