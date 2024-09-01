import { type CancellationToken } from "../../../agent/src/cancellation.ts";
import { FetchResult, Unknown, UiKind, TelemetryProperties } from "../types.ts";
import { Context } from "../context.ts";
import { TurnContext } from "./turnContext.ts";

import { ConversationPromptEngine } from "./prompt/conversationPromptEngine.ts";
import { getSupportedModelFamiliesForPrompt } from "./modelMetadata.ts";
import { conversationLogger } from "./logger.ts";
import { ModelConfigurationProvider } from "./modelConfigurations.ts";
import { ChatMLFetcher } from "./chatMLFetcher.ts";

class TurnSuggestions {
  constructor(
    readonly ctx: Context,
    // ./fetchPostProcessor.ts
    readonly chatFetcher: ChatMLFetcher
  ) { }

  async fetchRawSuggestions(
    turnContext: TurnContext,
    token: CancellationToken,
    uiKind: UiKind,
    telemetryProperties?: TelemetryProperties
  ): Promise<Unknown.SuggestionsFetchResult | undefined> {
    const telemetryPropertiesToUse = telemetryProperties ? { ...telemetryProperties } : {};
    telemetryPropertiesToUse.messageSource = 'chat.suggestions';

    const prompt = await this.ctx.get(ConversationPromptEngine).toPrompt(turnContext, { promptType: 'suggestions' });

    if (!prompt.toolConfig) throw new Error('No tool call configuration found in suggestions prompt.');

    const params: ChatMLFetcher.Params = {
      modelConfiguration: await this.ctx
        .get(ModelConfigurationProvider)
        .getBestChatModelConfig(getSupportedModelFamiliesForPrompt('suggestions')),
      messages: prompt.messages,
      uiKind: uiKind,
      telemetryProperties: telemetryPropertiesToUse,
      telemetryMeasurements: { promptTokenLen: prompt.tokens },
      tool_choice: prompt.toolConfig.tool_choice,
      tools: prompt.toolConfig.tools,
    };

    let response: ChatMLFetcher.Response = await this.chatFetcher.fetchResponse(params, token);

    if (response.type !== 'success') {
      conversationLogger.error(this.ctx, 'Failed to fetch suggestions, trying again...');
      response = await this.chatFetcher.fetchResponse(params, token);
    }

    if (response.type === 'success') {
      if (!response.toolCalls || response.toolCalls.length === 0) {
        conversationLogger.error(this.ctx, 'Missing tool call in suggestions response');
        return;
      }

      const firstToolCall = response.toolCalls[0];
      const { followUp, suggestedTitle } = prompt.toolConfig.extractArguments(firstToolCall);

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
