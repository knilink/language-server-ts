import type { Context } from '../../../../lib/src/context.ts';

import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { PromiseQueue } from '../../../../lib/src/util/promiseQueue.ts';
import { Type, Static } from '@sinclair/typebox';
import { CancellationToken } from 'vscode-languageserver';

async function handleTestingFlushPromiseQueueChecked(
  ctx: Context,
  token: CancellationToken,
  params: ParamsType
): Promise<['OK', null]> {
  await ctx.get(PromiseQueue).flush();
  return ['OK', null];
}
const Params = Type.Object({});
type ParamsType = Static<typeof Params>;
const handleTestingFlushPromiseQueue = addMethodHandlerValidation(Params, handleTestingFlushPromiseQueueChecked);

export { handleTestingFlushPromiseQueue };
