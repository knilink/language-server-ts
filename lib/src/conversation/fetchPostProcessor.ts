import { Unknown, UiKind } from '../types.ts';
import { v4 as uuidv4 } from 'uuid';
import { TurnContext } from './turnContext.ts';
import { TextDocument } from '../textDocument.ts';
import { CancellationToken } from '../../../agent/src/cancellation.ts';
import { TelemetryWithExp } from '../telemetry.ts';
import { createOffTopicMessageTelemetryData } from './telemetry.ts';

import { ConversationInspector } from './conversationInspector.ts';
import {
  createSuggestionShownTelemetryData,
  createUserMessageTelemetryData,
  createModelMessageTelemetryData,
} from './telemetry.ts';
import { conversationLogger } from './logger.ts';
import { ChunkingProvider } from './skills/projectContextSnippetProviders/localSnippets/ChunkingProvider.ts';
import { TurnSuggestions } from './turnSuggestions.ts';
import { ChatMLFetcher } from './chatMLFetcher.ts';

namespace ChatFetchResultPostProcessor {
  // ./extensibility/remoteAgentTurnProcessor.ts
  export type PostProcessResult =
    | {
        followup?: Unknown.FollowUp & { message: string };
        suggestedTitle?: string;
      }
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
    baseTelemetryWithExp: TelemetryWithExp,
    augmentedTelemetryWithExp: TelemetryWithExp,
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
      fetchResult.requestId,
      doc,
      augmentedTelemetryWithExp.extendedBy({}, { fileCount: this.turnContext.ctx.get(ChunkingProvider).workspaceCount })
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
          baseTelemetryWithExp,
          augmentedTelemetryWithExp,
          doc
        );
      case 'offTopic':
        return await this.processOffTopicFetchResult(augmentedTelemetryWithExp, uiKind, doc);
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

      case 'no_choices': {
        this.turnContext.turn.status = 'error';
        this.turnContext.turn.response = { message: 'No choices returned', type: 'server' };
        return {
          error: {
            message: 'Oops, no choices received from the server. Please try again.',
            responseIsFiltered: false,
            responseIsIncomplete: true,
          },
        };
      }
      case 'no_finish_reason': {
        this.turnContext.turn.status = 'error';

        if (appliedText?.length > 0) {
          this.turnContext.turn.response = {
            message: appliedText,
            type: 'model',
            references: this.turnContext.turn.response?.references,
          };
        } else {
          this.turnContext.turn.response = { message: 'No finish reason', type: 'server' };
        }

        return {
          error: {
            message: 'Oops, unexpected end of stream. Please try again.',
            responseIsFiltered: false,
            responseIsIncomplete: true,
          },
        };
      }

      case 'successMultiple':
      case 'tool_calls':
      case 'unknown':
        this.turnContext.turn.status = 'error';
        return {
          error: { message: 'Unknown server side error occurred. Please try again.', responseIsFiltered: false },
        };
    }
  }

  async processSuccessfulFetchResult(
    appliedText: string,
    responseNumTokens: number,
    requestId: string,
    cancelationToken: CancellationToken,
    uiKind: UiKind,
    baseTelemetryWithExp: TelemetryWithExp,
    augmentedTelemetryWithExp: TelemetryWithExp,
    doc?: TextDocument
  ): Promise<ChatFetchResultPostProcessor.PostProcessResult> {
    if (appliedText && appliedText.length > 0) {
      baseTelemetryWithExp.markAsDisplayed();
      augmentedTelemetryWithExp.markAsDisplayed();
      this.turnContext.turn.status = 'success';
      this.turnContext.turn.response = {
        message: appliedText,
        type: 'model',
        references: this.turnContext.turn.response?.references,
      };
      createModelMessageTelemetryData(
        this.turnContext.ctx,
        this.turnContext.conversation,
        uiKind,
        appliedText,
        responseNumTokens,
        requestId,
        doc,
        augmentedTelemetryWithExp
      );

      const suggestions = this.computeSuggestions
        ? await this.fetchSuggestions(cancelationToken, uiKind, baseTelemetryWithExp, doc)
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
    baseTelemetryWithExp: TelemetryWithExp,
    doc?: TextDocument
  ): Promise<Unknown.Suggestions | undefined> {
    const suggestionsFetchResult = await new TurnSuggestions(
      this.turnContext.ctx,
      this.chatFetcher
    ).fetchRawSuggestions(this.turnContext, cancelationToken, uiKind, baseTelemetryWithExp);
    if (!suggestionsFetchResult) return;

    const enrichedFollowup = this.enrichFollowup(suggestionsFetchResult, uiKind, baseTelemetryWithExp, doc);
    conversationLogger.debug(this.turnContext.ctx, 'Computed followup', enrichedFollowup);
    conversationLogger.debug(this.turnContext.ctx, 'Computed suggested title', suggestionsFetchResult.suggestedTitle);

    return { followUp: enrichedFollowup, suggestedTitle: suggestionsFetchResult.suggestedTitle };
  }
  ////////////////////////////////////////////////////////////////////////////////

  enrichFollowup(
    suggestionsFetchResult: TurnSuggestions.SuggestionsFetchResult,
    uiKind: UiKind,
    baseTelemetryWithExp: TelemetryWithExp,
    doc?: TextDocument
  ) {
    let extendedTelemetry = baseTelemetryWithExp.extendedBy(
      { messageSource: 'chat.suggestions', suggestionId: uuidv4(), suggestion: 'Follow-up from model' },
      { promptTokenLen: suggestionsFetchResult.promptTokenLen, numTokens: suggestionsFetchResult.numTokens }
    );
    createSuggestionShownTelemetryData(this.turnContext.ctx, uiKind, extendedTelemetry, doc);
    return {
      message: suggestionsFetchResult.followUp,
      id: extendedTelemetry.properties.suggestionId,
      type: extendedTelemetry.properties.suggestion,
    };
  }

  async processOffTopicFetchResult(baseTelemetryWithExp: TelemetryWithExp, uiKind: UiKind, doc?: TextDocument) {
    const offTopicMessage = 'Sorry, but I can only assist with programming related questions.';
    this.turnContext.turn.response = { message: offTopicMessage, type: 'offtopic-detection' };
    this.turnContext.turn.status = 'off-topic';
    createOffTopicMessageTelemetryData(
      this.turnContext.ctx,
      this.turnContext.conversation,
      uiKind,
      offTopicMessage,
      baseTelemetryWithExp.properties.messageId,
      doc,
      baseTelemetryWithExp
    );
    return { error: { message: offTopicMessage, responseIsFiltered: true } };
  }
}

export { ChatFetchResultPostProcessor };
