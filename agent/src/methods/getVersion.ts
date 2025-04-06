import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../lib/src/context.ts';

import { BuildInfo, getBuildType } from '../../../lib/src/config.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({});

async function handleGetVersionChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[{ version: string; buildType: string; runtimeVersion: string }, null]> {
  return [
    {
      version: ctx.get(BuildInfo).getDisplayVersion(),
      buildType: getBuildType(ctx),
      runtimeVersion: `node/${process.versions.node}`,
    },
    null,
  ];
}

const handleGetVersion = addMethodHandlerValidation(Params, handleGetVersionChecked);

export { handleGetVersion };
