import { type CancellationToken } from '../../../agent/src/cancellation.ts';
import { UiKind } from '../types.ts';
import { Context } from '../context.ts';
import { TurnContext } from './turnContext.ts';

import { ConversationPromptEngine } from './prompt/conversationPromptEngine.ts';
import { getSupportedModelFamiliesForPrompt } from './modelMetadata.ts';
import { conversationLogger } from './logger.ts';
import { ModelConfigurationProvider } from './modelConfigurations.ts';
import { ChatMLFetcher } from './chatMLFetcher.ts';
import { TelemetryWithExp } from '../telemetry.ts';

namespace TurnSuggestions {
  export type SuggestionsFetchResult = {
    followUp: string;
    suggestedTitle: string;
    promptTokenLen: number;
    numTokens: number;
  };
}

class TurnSuggestions {
  constructor(
    readonly ctx: Context,
    // ./fetchPostProcessor.ts
    readonly chatFetcher: ChatMLFetcher
  ) {}

  async fetchRawSuggestions(
    turnContext: TurnContext,
    token: CancellationToken,
    uiKind: UiKind,
    baseTelemetryWithExp: TelemetryWithExp
  ): Promise<TurnSuggestions.SuggestionsFetchResult | undefined> {
    const modelConfiguration = await this.ctx
      .get(ModelConfigurationProvider)
      .getBestChatModelConfig(getSupportedModelFamiliesForPrompt('suggestions'), { tool_calls: true });
    const promptOptions = { promptType: 'suggestions' as 'suggestions', modelConfiguration: modelConfiguration };
    const prompt = await this.ctx.get(ConversationPromptEngine).toPrompt(turnContext, promptOptions);
    const extendedTelemetry = baseTelemetryWithExp.extendedBy(
      { messageSource: 'chat.suggestions' },
      { promptTokenLen: prompt.tokens }
    );
    const params: ChatMLFetcher.Params = {
      modelConfiguration,
      messages: prompt.messages,
      uiKind,
    };
    if (prompt.toolConfig === undefined) throw new Error('No tool call configuration found in suggestions prompt.');
    params.tool_choice = prompt.toolConfig.tool_choice;
    params.tools = prompt.toolConfig.tools;
    let response = await this.chatFetcher.fetchResponse(params, token, extendedTelemetry);

    if (response.type !== 'success') {
      conversationLogger.error(this.ctx, 'Failed to fetch suggestions, trying again...');
      response = await this.chatFetcher.fetchResponse(params, token, extendedTelemetry);
    }

    if (response.type === 'success') {
      if (!response.toolCalls || response.toolCalls.length === 0) {
        conversationLogger.error(this.ctx, 'Missing tool call in suggestions response');
        return;
      }
      let firstToolCall = response.toolCalls[0];
      let { followUp: followUp, suggestedTitle: suggestedTitle } = prompt.toolConfig.extractArguments(firstToolCall);
      if (!followUp || !suggestedTitle) {
        conversationLogger.error(this.ctx, 'Missing follow-up or suggested title in suggestions response');
        return;
      }
      return {
        followUp: followUp.trim(),
        suggestedTitle: suggestedTitle.trim(),
        promptTokenLen: prompt.tokens,
        numTokens: response.numTokens + firstToolCall.approxNumTokens,
      };
    } else if (response.type === 'successMultiple') {
      conversationLogger.error(this.ctx, 'successMultiple response is unexpected for suggestions');
      return;
    } else if (response.type === 'tool_calls') {
      conversationLogger.error(this.ctx, 'tool_calls response is unexpected for suggestions');
      return;
    } else {
      conversationLogger.error(this.ctx, `Failed to fetch suggestions due to reason: ${response.reason}`);
      return;
    }
  }
}

export { TurnSuggestions };
