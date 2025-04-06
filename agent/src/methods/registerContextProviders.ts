import type { Context } from '../../../lib/src/context.ts';
import type { ContextProviderRegistrationType } from '../../../lib/src/prompt/contextProviders/contextItemSchemas.ts';

import { LspClientContextProvider } from '../contextProvider.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { ContextProviderRegistry } from '../../../lib/src/prompt/contextProviderRegistry.ts';
import { ContextProviderRegistrationSchema } from '../../../lib/src/prompt/contextProviders/contextItemSchemas.ts';

async function registerContextProviders(
  ctx: Context,
  token: unknown,
  params: ContextProviderRegistrationType
): Promise<[{ unregistered: string[]; registered: string[] }, null]> {
  const registry = ctx.get(ContextProviderRegistry);
  const result: { unregistered: string[]; registered: string[] } = { unregistered: [], registered: [] };

  params.providers.forEach((providerDescription) => {
    try {
      const provider = new LspClientContextProvider(ctx, providerDescription.id, providerDescription.selector);
      registry.registerContextProvider(provider);
      result.registered.push(providerDescription.id);
    } catch {
      result.unregistered.push(providerDescription.id);
    }
  });

  return [result, null];
}
const Params = ContextProviderRegistrationSchema;
const handleRegisterContextProviders = addMethodHandlerValidation(Params, registerContextProviders);

export { handleRegisterContextProviders };
