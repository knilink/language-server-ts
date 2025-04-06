import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';

import { telemetryGitHubLoginSuccess } from '../../../../lib/src/telemetry/auth.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({
  authType: Type.Union([Type.Literal('editorAuth'), Type.Literal('deviceFlow')]),
});

async function handleTelemetryGitHubLoginSuccessChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  telemetryGitHubLoginSuccess(ctx, params.authType);
  return ['OK', null];
}

const handleTelemetryGitHubLoginSuccess = addMethodHandlerValidation(Params, handleTelemetryGitHubLoginSuccessChecked);

export { handleTelemetryGitHubLoginSuccess };
