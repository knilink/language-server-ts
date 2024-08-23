import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';

import { type Context } from '../../../../lib/src/context';
import { getAgents } from '../../../../lib/src/conversation/agents/agents';
import { TestingOptions } from '../testingOptions';
import { ensureAuthenticated } from '../../auth/authDecorator';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({ options: Type.Optional(TestingOptions) });

type Agent = {
  slug: string;
  name: string;
  description: string;
  avatarUrl?: string;
};

async function handleConversationAgentsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[Agent[], null]> {
  return [
    (await getAgents(ctx)).map((a) => ({
      slug: a.slug,
      name: a.name,
      description: a.description,
      avatarUrl: 'avatarUrl' in a ? a.avatarUrl : undefined,
    })),
    null,
  ];
}

const handleConversationAgents = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationAgentsChecked)
);

export { handleConversationAgents };
