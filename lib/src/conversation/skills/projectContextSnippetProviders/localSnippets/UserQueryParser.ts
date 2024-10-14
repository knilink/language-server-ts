import { type CancellationToken } from '../../../../../../agent/src/cancellation.ts';
import { ModelConfigurationProvider } from '../../../modelConfigurations.ts';
import { getSupportedModelFamiliesForPrompt } from '../../../modelMetadata.ts';
import { ConversationPromptEngine } from '../../../prompt/conversationPromptEngine.ts';
import { conversationLogger } from '../../../logger.ts';
import { ChatMLFetcher } from '../../../chatMLFetcher.ts';
import { createTelemetryWithExpWithId } from '../../../telemetry.ts';
import { telemetryException } from '../../../../telemetry.ts';
import { LocalSnippetProviderError } from './LocalSnippetProvider.ts';
import { TurnContext } from '../../../turnContext.ts';
import { PromptOptions } from '../../../prompt/strategies/types.ts';

async function parseUserQuery(turnContext: TurnContext, token: CancellationToken): Promise<string[] | undefined> {
  const ctx = turnContext.ctx;
  const modelConfiguration = await ctx
    .get(ModelConfigurationProvider)
    .getBestChatModelConfig(getSupportedModelFamiliesForPrompt('synonyms'), { tool_calls: true });
  const promptOptions: PromptOptions = { promptType: 'synonyms', modelConfiguration };
  const userQueryPrompt = await ctx.get(ConversationPromptEngine).toPrompt(turnContext, promptOptions);
  if (!userQueryPrompt.toolConfig) {
    return;
  }
  const params: ChatMLFetcher.Params = {
    modelConfiguration,
    uiKind: 'conversationPanel',
    messages: userQueryPrompt.messages,
    tools: userQueryPrompt.toolConfig?.tools,
    tool_choice: userQueryPrompt.toolConfig?.tool_choice,
  };
  const fetcher = new ChatMLFetcher(ctx);
  const telemetry = await createTelemetryWithExpWithId(ctx, turnContext.turn.id, turnContext.conversation.id);
  const fetchResult = await fetcher.fetchResponse(
    params,
    token,
    telemetry.extendedBy({ messageSource: 'chat.synonyms' })
  );
  if (fetchResult.type === 'success' && fetchResult.toolCalls && fetchResult.toolCalls.length > 0) {
    const firstTool = fetchResult.toolCalls[0];
    const keywords = userQueryPrompt.toolConfig?.extractArguments(firstTool).keywords;
    if (!keywords || !Array.isArray(keywords)) return undefined;
    conversationLogger.debug(
      ctx,
      `UserQueryParser: Parsed ${keywords.length} keywords from the original user query: ${keywords.join(', ')}`
    );
    return keywords.length ? keywords : undefined;
  } else {
    const reason = 'reason' in fetchResult ? fetchResult.reason : '';
    telemetryException(
      ctx,
      new LocalSnippetProviderError(
        `Failed to request user query synonyms, result type: ${fetchResult.type}, reason: ${reason}`
      ),
      'LocalSnippetProvider.parseUserQuery'
    );
  }
}

export { parseUserQuery };
