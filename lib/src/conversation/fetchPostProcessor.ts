import { TelemetryProperties, Unknown, UiKind, FetchResult } from '../types.ts';
import { v4 as uuidv4 } from 'uuid';
import { TurnContext } from './turnContext.ts';
import { TextDocument } from '../textDocument.ts';
import { CancellationToken } from '../../../agent/src/cancellation.ts';
import { TelemetryData } from '../telemetry.ts';
import { createOffTopicMessageTelemetryData } from './telemetry.ts';

import { ConversationInspector } from './conversationInspector.ts';
import {
  createSuggestionShownTelemetryData,
  createTelemetryWithId,
  createUserMessageTelemetryData,
  createModelMessageTelemetryData,
} from './telemetry.ts';
import { conversationLogger } from './logger.ts';
import { TurnSuggestions } from './turnSuggestions.ts';
import { ChatMLFetcher } from './chatMLFetcher.ts';

namespace ChatFetchResultPostProcessor {
  // ./extensibility/remoteAgentTurnProcessor.ts
  export type PostProcessResult =
    | Partial<Unknown.Suggestions>
    | {
        error: {
          message: string;
          responseIsFiltered?: boolean;
          responseIsIncomplete?: boolean;
        };
      };
}

class ChatFetchResultPostProcessor {
  constructor(
    readonly turnContext: TurnContext,
    // ChatMLFetcher ./turnProcessor.ts
    readonly chatFetcher: ChatMLFetcher,
    readonly computeSuggestions: boolean
  ) {}

  async postProcess(
    fetchResult: ChatMLFetcher.Response,
    // fetchResult: FetchResult,
    token: CancellationToken,
    appliedText: string,
    baseUserTelemetry: TelemetryData,
    messageText: string,
    uiKind: UiKind,
    // optional ./turnProcessor.ts
    doc?: TextDocument
  ): Promise<ChatFetchResultPostProcessor.PostProcessResult> {
    createUserMessageTelemetryData(
      this.turnContext.ctx,
      uiKind,
      messageText,
      fetchResult.type === 'offTopic',
      doc,
      baseUserTelemetry
    );
    this.turnContext.ctx.get(ConversationInspector).inspectFetchResult(fetchResult);
    switch (fetchResult.type) {
      case 'success':
        return await this.processSuccessfulFetchResult(
          appliedText,
          fetchResult.numTokens,
          fetchResult.requestId,
          token,
          uiKind,
          doc
        );
      case 'offTopic':
        return await this.processOffTopicFetchResult(baseUserTelemetry, uiKind, doc);
      case 'canceled':
        this.turnContext.turn.status = 'cancelled';
        this.turnContext.turn.response = { message: 'Cancelled', type: 'user' };
        return { error: this.turnContext.turn.response };
      case 'failed':
        this.turnContext.turn.status = 'error';
        this.turnContext.turn.response = { message: fetchResult.reason, type: 'server' };
        return { error: { message: this.translateErrorMessage(fetchResult.code) } };
      case 'filtered':
        this.turnContext.turn.status = 'filtered';
        return {
          error: {
            message: "Oops, your response got filtered. Vote down if you think this shouldn't have happened.",
            responseIsFiltered: true,
          },
        };
      case 'length':
        this.turnContext.turn.status = 'error';
        return {
          error: {
            message: 'Oops, the response got too long. Try to reformulate your question.',
            responseIsIncomplete: true,
          },
        };
      case 'agentAuthRequired':
        this.turnContext.turn.status = 'error';
        this.turnContext.turn.response = { message: 'Authorization required', type: 'server' };
        return { error: { message: 'Authorization required', responseIsFiltered: false } };
      case 'successMultiple':
      case 'tool_calls':
      case 'unknown':
        this.turnContext.turn.status = 'error';
        return { error: { message: 'Oops, no response has returned.', responseIsFiltered: false } };
    }
  }

  async processSuccessfulFetchResult(
    appliedText: string,
    responseNumTokens: number,
    requestId: string,
    cancelationToken: CancellationToken,
    uiKind: UiKind,
    doc?: TextDocument
  ) {
    if (appliedText && appliedText.length > 0) {
      const baseModelTelemetry = createTelemetryWithId(this.turnContext.turn.id, this.turnContext.conversation.id);
      this.turnContext.turn.status = 'success';
      this.turnContext.turn.response = { message: appliedText, type: 'model' };
      baseModelTelemetry.markAsDisplayed();
      const telemetryMessageId = createModelMessageTelemetryData(
        this.turnContext.ctx,
        this.turnContext.conversation,
        uiKind,
        appliedText,
        responseNumTokens,
        requestId,
        doc,
        baseModelTelemetry
      );
      const suggestions = this.computeSuggestions
        ? await this.fetchSuggestions(
            cancelationToken,
            uiKind,
            { messageId: telemetryMessageId, conversationId: this.turnContext.conversation.id },
            doc
          )
        : undefined;
      if (suggestions) {
        const { followUp, suggestedTitle } = suggestions;
        return {
          followup: followUp.message !== '' ? followUp : undefined, // MARK, "followup" ?? "followUp" wtf
          suggestedTitle: suggestedTitle !== '' ? suggestedTitle : undefined,
        };
      }
      return {};
    }
    this.turnContext.turn.status = 'error';
    this.turnContext.turn.response = {
      message: 'The model returned successful but did not contain any response text.',
      type: 'meta',
    };
    return { error: this.turnContext.turn.response };
  }

  translateErrorMessage(errorCode?: number): string {
    switch (errorCode) {
      case 466:
        return 'Oops, your plugin is out of date. Please update it.';
      case 401:
        return 'Oops, you are not authorized. Please sign in.';
      case 429:
        return 'Oops, there was a problem with your request. Please try again.';
      default:
        return 'Sorry, an error occurred while generating a response.';
    }
  }

  async fetchSuggestions(
    cancelationToken: CancellationToken,
    uiKind: UiKind,
    telemetryProperties?: TelemetryProperties,
    doc?: TextDocument
  ): Promise<Unknown.Suggestions | undefined> {
    const suggestionsFetchResult = await new TurnSuggestions(
      this.turnContext.ctx,
      this.chatFetcher
    ).fetchRawSuggestions(this.turnContext, cancelationToken, uiKind, telemetryProperties);
    if (!suggestionsFetchResult) return;

    const enrichedFollowup = this.enrichFollowup(suggestionsFetchResult, uiKind, telemetryProperties, doc);
    conversationLogger.debug(this.turnContext.ctx, 'Computed followup', enrichedFollowup);
    conversationLogger.debug(this.turnContext.ctx, 'Computed suggested title', suggestionsFetchResult.suggestedTitle);

    return { followUp: enrichedFollowup, suggestedTitle: suggestionsFetchResult.suggestedTitle };
  }
  ////////////////////////////////////////////////////////////////////////////////

  private enrichFollowup(
    suggestionsFetchResult: Unknown.SuggestionsFetchResult,
    uiKind: UiKind,
    telemetryProperties?: TelemetryProperties,
    doc?: TextDocument
  ) {
    const telemetryPropertiesToUse = telemetryProperties ? telemetryProperties : {};
    const suggestionId = uuidv4();
    const suggestionType = 'Follow-up from model';
    telemetryPropertiesToUse.suggestionId = suggestionId;
    telemetryPropertiesToUse.suggestionType = suggestionType;

    const telemetryMeasurements = {
      promptTokenLen: suggestionsFetchResult.promptTokenLen,
      numTokens: suggestionsFetchResult.numTokens,
    };

    createSuggestionShownTelemetryData(
      this.turnContext.ctx,
      uiKind,
      telemetryPropertiesToUse.suggestionType,
      telemetryPropertiesToUse.messageId,
      telemetryPropertiesToUse.conversationId,
      suggestionId,
      doc,
      telemetryMeasurements
    );

    return {
      message: suggestionsFetchResult.followUp,
      id: suggestionId,
      type: suggestionType,
    };
  }

  async processOffTopicFetchResult(baseUserTelemetry: TelemetryData, uiKind: UiKind, doc?: TextDocument) {
    const baseOffTopicTelemetry = createTelemetryWithId(this.turnContext.turn.id, this.turnContext.conversation.id);
    const offTopicMessage = 'Sorry, but I can only assist with programming related questions.';
    this.turnContext.turn.response = { message: offTopicMessage, type: 'offtopic-detection' };
    this.turnContext.turn.status = 'off-topic';
    baseOffTopicTelemetry.markAsDisplayed();
    createOffTopicMessageTelemetryData(
      this.turnContext.ctx,
      this.turnContext.conversation,
      uiKind,
      offTopicMessage,
      baseUserTelemetry.properties.messageId,
      doc,
      baseOffTopicTelemetry
    );
    return {};
  }
}

export { ChatFetchResultPostProcessor };
