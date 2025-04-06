import { Type, type Static } from '@sinclair/typebox';
import { ErrorCode } from '../../rpc.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { CopilotContentExclusionManager } from '../../../../lib/src/contentExclusion/contentExclusionManager.ts';
import { RulesSchema } from '../../../../lib/src/contentExclusion/contentExclusions.ts';
import { Context } from '../../../../lib/src/context.ts';

// import '../node_modules/@sinclair/typebox/build/esm/index.mjs';

const Params = Type.Object({ rules: RulesSchema });

async function handleTestingSetContentExclusionRulesChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<['OK', null] | [null, { code: number; message: string }]> {
  let manager = ctx.get(CopilotContentExclusionManager);
  if (manager) {
    manager.setTestingRules(params.rules);
    return ['OK', null];
  }
  return [null, { code: ErrorCode.InternalError, message: 'Could not set content exclusion rules' }];
}
let handleTestingSetContentExclusionRules = addMethodHandlerValidation(
  Params,
  handleTestingSetContentExclusionRulesChecked
);

export { handleTestingSetContentExclusionRules };
