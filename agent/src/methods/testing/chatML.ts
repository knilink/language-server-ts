import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';

import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { ChatMLFetcher } from '../../../../lib/src/conversation/chatMLFetcher.ts';
import { ModelConfigurationProvider } from '../../../../lib/src/conversation/modelConfigurations.ts';
import { ChatModelFamily } from '../../../../lib/src/conversation/modelMetadata.ts';
import { ChatRole } from '../../../../lib/src/conversation/openai/openai.ts';
import { createTelemetryWithExpWithId } from '../../../../lib/src/conversation/telemetry.ts';
import { Type } from '@sinclair/typebox';

const Params = Type.Object({
  options: Type.Optional(TestingOptions),
  messages: Type.Array(
    Type.Object({
      role: Type.Enum(ChatRole),
      content: Type.String(),
      name: Type.Optional(Type.String()),
    })
  ),
  modelFamily: Type.Optional(Type.Enum(ChatModelFamily)),
  stop: Type.Optional(Type.Array(Type.String())),
  conversationOptions: Type.Optional(
    Type.Object({
      maxResponseTokens: Type.Optional(Type.Number()),
      temperature: Type.Optional(Type.Number()),
    })
  ),
});

async function handleChatMLChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[ChatMLFetcher.Response, null]> {
  const fetcher = new ChatMLFetcher(ctx);
  const modelConfiguration = await ctx
    .get(ModelConfigurationProvider)
    .getBestChatModelConfig([params.modelFamily ?? ChatModelFamily.Gpt35turbo]);
  const telemetryWithExp = await createTelemetryWithExpWithId(ctx, '', '');

  return [
    await fetcher.fetchResponse(
      {
        modelConfiguration,
        messages: params.messages,
        uiKind: 'conversationIntegrationTest',
        stop: params.stop,
        intentParams: { intent: true },
      },
      token,
      telemetryWithExp
    ),
    null,
  ];
}

const handleChatML = ensureAuthenticated(addMethodHandlerValidation(Params, handleChatMLChecked));

export { handleChatML };
