import { Type, type Static } from '@sinclair/typebox';

import { type CancellationToken } from "../../cancellation.ts";
import { type Context } from "../../../../lib/src/context.ts";

import { telemetryGitHubLoginSuccess } from "../../../../lib/src/telemetry/auth.ts";
import { addMethodHandlerValidation } from "../../schemaValidation.ts";

const Params = Type.Object({
  authType: Type.Union([Type.Literal('editorAuth'), Type.Literal('deviceFlow')]),
});

async function handleTelemetryGitHubLoginSuccessChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[string, null]> {
  return await telemetryGitHubLoginSuccess(ctx, params.authType), ['OK', null];
}

const handleTelemetryGitHubLoginSuccess = addMethodHandlerValidation(Params, handleTelemetryGitHubLoginSuccessChecked);

export { handleTelemetryGitHubLoginSuccess };
