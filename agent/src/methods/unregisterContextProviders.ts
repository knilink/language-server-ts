import type { Context } from '../../../lib/src/context.ts';
import type { Static } from '@sinclair/typebox';

import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { ContextProviderRegistry } from '../../../lib/src/prompt/contextProviderRegistry.ts';
import { ContextProviderUnregisterSchema } from '../../../lib/src/prompt/contextProviders/contextItemSchemas.ts';

async function unregisterContextProviders(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<[{ unregistered: string[]; notUnregistered: string[] }, null]> {
  const registry = ctx.get(ContextProviderRegistry);
  const result: { unregistered: string[]; notUnregistered: string[] } = { unregistered: [], notUnregistered: [] };

  params.providers.forEach((providerDescription) => {
    try {
      registry.unregisterContextProvider(providerDescription.id);
      result.unregistered.push(providerDescription.id);
    } catch {
      result.notUnregistered.push(providerDescription.id);
    }
  });

  return [result, null];
}

const Params = ContextProviderUnregisterSchema;

const handleUnregisterContextProviders = addMethodHandlerValidation(Params, unregisterContextProviders);

export { handleUnregisterContextProviders };
