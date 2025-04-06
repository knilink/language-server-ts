import type { Static } from '@sinclair/typebox';
import type { RemoteAgentTurnProcessor } from '../../../../lib/src/conversation/extensibility/remoteAgentTurnProcessor.ts';
import type { Context } from '../../../../lib/src/context.ts';

import { getAgents } from '../../../../lib/src/conversation/agents/agents.ts';
import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({ options: Type.Optional(TestingOptions) });

type Agent = {
  slug: string;
  name: string;
  description: string;
  avatarUrl?: string;
};

async function handleConversationAgentsChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<[Agent[], null]> {
  return [
    (await getAgents(ctx)).map((a) => ({
      slug: a.slug,
      name: a.name,
      description: a.description,
      avatarUrl: a.avatarUrl,
    })),
    null,
  ];
}

const handleConversationAgents = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationAgentsChecked)
);

export { handleConversationAgents };
