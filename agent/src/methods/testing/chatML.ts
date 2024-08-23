import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation';
import { Context } from '../../../../lib/src/context';
import { ModelConfigurationProvider } from '../../../../lib/src/conversation/modelConfigurations';
import { TestingOptions } from '../testingOptions';
import { ChatRole } from '../../../../lib/src/conversation/openai/openai';
import { ChatModelFamily } from '../../../../lib/src/conversation/modelMetadata';
import { ensureAuthenticated } from '../../auth/authDecorator';
import { addMethodHandlerValidation } from '../../schemaValidation';
import { ChatMLFetcher } from '../../../../lib/src/conversation/chatMLFetcher';

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
  const modelFamily = params.modelFamily ?? ChatModelFamily.Gpt35turbo;
  const modelConfiguration = await ctx.get(ModelConfigurationProvider).getBestChatModelConfig([modelFamily]);

  return [
    await fetcher.fetchResponse(
      {
        modelConfiguration,
        messages: params.messages,
        uiKind: 'conversationIntegrationTest',
        stop: params.stop,
        intentParams: { intent: true },
      },
      token
    ),
    null,
  ];
}

const handleChatML = ensureAuthenticated(addMethodHandlerValidation(Params, handleChatMLChecked));

export { handleChatML };
