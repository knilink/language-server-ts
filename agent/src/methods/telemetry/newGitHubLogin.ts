import type { Static } from '@sinclair/typebox';
import type { Context } from '../../../../lib/src/context.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';

import { telemetryNewGitHubLogin } from '../../../../lib/src/telemetry/auth.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({
  authSource: Type.Union([Type.Literal('toast'), Type.Literal('goldbar'), Type.Literal('menu')]),
  authType: Type.Union([Type.Literal('editorAuth'), Type.Literal('deviceFlow')]),
});

async function handleTelemetryNewGitHubLoginChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  telemetryNewGitHubLogin(ctx, params.authSource, params.authType);
  return ['OK', null];
}

const handleTelemetryNewGitHubLogin = addMethodHandlerValidation(Params, handleTelemetryNewGitHubLoginChecked);

export { handleTelemetryNewGitHubLogin };
