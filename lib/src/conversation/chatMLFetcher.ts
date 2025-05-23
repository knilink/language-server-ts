import type { Context } from '../context.ts';
import type { Chat, Model, TelemetryMeasurements, TelemetryProperties, ToolCall, UiKind } from '../types.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';

import { v4 as uuidv4 } from 'uuid';
import { getChatURL } from './openai/config.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { telemetry, TelemetryWithExp } from '../telemetry.ts';
import { asyncIterableMapFilter } from '../common/iterableHelpers.ts';
import { conversationLogger } from './logger.ts';
import { isRepetitive } from '../suggestions/anomalyDetection.ts';
import { isAbortError } from '../networking.ts';
import { OpenAIChatMLFetcher } from './openai/fetch.ts';
import { SSEProcessor } from '../openai/stream.ts';
import { OpenAIFetcher } from '../openai/fetch.ts';
import { ChatCompletion } from './openai/openai.ts';

namespace ChatMLFetcher {
  export type SuccessfulResponse =
    | {
        type: 'success';
        value: string;
        // ./skills/projectContextSnippetProviders/localSnippets/UserQueryParser.ts
        toolCalls?: ToolCall[];
        requestId: string;
        numTokens: number;
      }
    | {
        type: 'tool_calls';
        toolCalls?: ToolCall[];
        requestId: string;
      }
    | {
        type: 'filtered';
        reason: string;
        requestId: string;
      }
    | {
        type: 'length';
        reason: string;
        requestId: string;
      }
    | {
        type: 'successMultiple';
        value: string[]; // messages[].content
        toolCalls?: ToolCall[][];
        requestId: string;
      }
    | {
        type: 'no_finish_reason';
        reason: string;
        requestId: string;
      }
    | {
        type: 'no_choices';
        reason: string;
        requestId: string;
      }
    | {
        type: 'unknown';
        reason: string;
        requestId: string;
      };

  export type CanceledResponse = {
    type: 'canceled';
    reason: string;
    requestId: string;
  };

  export type FailedResponse =
    | { type: 'offTopic'; reason: string; requestId: string }
    | { type: 'model_not_supported'; reason: string; requestId: string }
    | { type: 'failed'; reason: string; requestId: string; code?: number };

  export type AuthRequiredResponse = {
    type: 'agentAuthRequired';
    reason: string;
    authUrl: string;
    requestId: string;
  };

  export type Response =
    | ChatMLFetcher.SuccessfulResponse
    | ChatMLFetcher.CanceledResponse
    | ChatMLFetcher.FailedResponse
    | ChatMLFetcher.AuthRequiredResponse;

  export type Params = {
    messages: Chat.ElidableChatMessage[];
    uiKind: UiKind;
  } & Partial<{
    temperature: OpenAIFetcher.ConversationRequest['temperature'];
    num_suggestions: OpenAIFetcher.ConversationRequest['n'];
    stop: OpenAIFetcher.ConversationRequest['stop'];
    topP: OpenAIFetcher.ConversationRequest['top_p'];
    logitBias: OpenAIFetcher.ConversationRequest['logit_bias'];
    tools: OpenAIFetcher.ConversationRequest['tools'];
    tool_choice: OpenAIFetcher.ConversationRequest['tool_choice'];
    engineUrl: string;
    endpoint: string;
    authToken: string;
    intentParams: Partial<OpenAIFetcher.ConversationParams>;
    // optional ../../../agent/src/methods/testing/chatML.ts
    telemetryProperties: TelemetryProperties;
    // optional ../../../agent/src/methods/testing/chatML.ts
    telemetryMeasurements: TelemetryMeasurements;
    // agent?.sessionId uuid ./extensibility/remoteAgentTurnProcessor.ts
    copilot_thread_id?: string;
    // ../../../agent/src/methods/testing/chatML.ts
    modelConfiguration: Model.Configuration;
  }>;
}

class ChatMLFetcher {
  readonly fetcher = new OpenAIChatMLFetcher();
  constructor(readonly ctx: Context) {}

  async fetchResponse(
    params: ChatMLFetcher.Params,
    cancellationToken: CancellationToken,
    baseTelemetryWithExp: TelemetryWithExp,
    finishedCb?: SSEProcessor.FinishedCb
  ) {
    const ourRequestId = uuidv4();
    const postOptions: OpenAIFetcher.ConversationParams['postOptions'] = {
      stream: true,
      n: params.num_suggestions ?? 1,
      temperature: params.temperature ?? 0,
      stop: params.stop,
      top_p: params.topP ?? 1,
      copilot_thread_id: params.copilot_thread_id,
    };
    const modelConfiguration = params.modelConfiguration;

    if (modelConfiguration) {
      postOptions.max_tokens = modelConfiguration.maxResponseTokens;
    }

    if (params.logitBias) {
      postOptions.logit_bias = params.logitBias;
    }
    const engineUrl = params.engineUrl ?? (await getChatURL(this.ctx));
    const endpoint = params.endpoint ?? 'completions';
    const authToken = params.authToken ?? (await this.ctx.get(CopilotTokenManager).getToken()).token;
    const chatParams: OpenAIFetcher.ConversationParams = {
      messages: params.messages,
      repoInfo: undefined,
      ourRequestId,
      engineUrl,
      endpoint,
      count: params.num_suggestions ?? 1,
      uiKind: params.uiKind,
      postOptions,
      authToken,
      ...params.intentParams,
    };

    if (modelConfiguration) {
      chatParams.model = modelConfiguration.modelId;
    }

    if (params.tools && params.tools.length > 0) {
      chatParams.tools = params.tools;
      chatParams.tool_choice = params.tool_choice ?? 'auto';
    }
    return await this.fetch(chatParams, finishedCb, cancellationToken, baseTelemetryWithExp);
  }

  async fetch(
    chatParams: OpenAIFetcher.ConversationParams,
    finishedCb: SSEProcessor.FinishedCb | undefined,
    cancellationToken: CancellationToken,
    baseTelemetryWithExp: TelemetryWithExp
  ): Promise<ChatMLFetcher.Response> {
    try {
      const response: OpenAIFetcher.ConversationResponse = await this.fetcher.fetchAndStreamChat(
        this.ctx,
        chatParams,
        baseTelemetryWithExp.extendedBy({ uiKind: chatParams.uiKind }),
        finishedCb || (async () => undefined),
        cancellationToken
      );
      switch (response.type) {
        case 'success':
          return await this.processSuccessfulResponse(response, chatParams.ourRequestId, baseTelemetryWithExp);
        case 'canceled':
          return this.processCanceledResponse(response, chatParams.ourRequestId);
        case 'failed':
        case 'failedDependency':
          return this.processFailedResponse(response, chatParams.ourRequestId);
        case 'authRequired':
          return {
            type: 'agentAuthRequired',
            reason: 'Agent authentication required.',
            authUrl: response.authUrl,
            requestId: chatParams.ourRequestId,
          };
      }
    } catch (err) {
      return this.processError(err as Error, chatParams.ourRequestId);
    }
  }

  async processSuccessfulResponse(
    response: Extract<OpenAIFetcher.ConversationResponse, { type: 'success' }>,
    requestId: string, // ourRequestId
    baseTelemetryWithExp: TelemetryWithExp
  ): Promise<ChatMLFetcher.SuccessfulResponse> {
    const results: ChatCompletion[] = [];
    const postProcessed = asyncIterableMapFilter(response.chatCompletions, async (completion) =>
      this.postProcess(completion, baseTelemetryWithExp)
    );
    for await (const chatCompletion of postProcessed) {
      conversationLogger.debug(this.ctx, `Received choice: ${JSON.stringify(chatCompletion, null, 2)} `);
      results.push(chatCompletion);
    }
    if (results.length === 1) {
      const result = results[0];
      switch (result.finishReason) {
        case 'stop':
          return {
            type: 'success',
            value: result.message?.content ?? '',
            toolCalls: result.tool_calls,
            requestId,
            numTokens: result.numTokens,
          };
        case 'tool_calls':
          return { type: 'tool_calls', toolCalls: result.tool_calls, requestId };
        case 'content_filter':
          return { type: 'filtered', reason: 'Response got filtered.', requestId };
        case 'length':
          return { type: 'length', reason: 'Response too long.', requestId };
        case 'DONE':
          return { type: 'no_finish_reason', reason: 'No finish reason received.', requestId: requestId };
        default:
          return { type: 'unknown', reason: 'Unknown finish reason received.', requestId: requestId };
      }
    } else if (results.length > 1) {
      const filtered_results = results.filter((r) => r.finishReason === 'stop' || r.finishReason === 'tool_calls');
      if (filtered_results.length > 0) {
        return {
          type: 'successMultiple',
          value: filtered_results.map((r) => r.message.content),
          toolCalls: filtered_results.map((r) => r.tool_calls).filter((f) => !!f),
          requestId,
        };
      }
    }
    return { type: 'no_choices', reason: 'Response contained no choices.', requestId };
  }

  async postProcess(
    chatCompletion: ChatCompletion,
    baseTelemetryWithExp: TelemetryWithExp
  ): Promise<ChatCompletion | undefined> {
    if (isRepetitive(chatCompletion.tokens)) {
      baseTelemetryWithExp.extendWithRequestId(chatCompletion.requestId);
      telemetry(this.ctx, 'conversation.repetition.detected', baseTelemetryWithExp, 0);
      return chatCompletion.finishReason !== '' ? chatCompletion : undefined;
    }
    return chatCompletion.message ? chatCompletion : undefined;
  }

  processCanceledResponse(
    response: Extract<OpenAIFetcher.ConversationResponse, { type: 'canceled' }>,
    requestId: string
  ): any {
    conversationLogger.debug(this.ctx, 'Cancelled after awaiting fetchConversation');
    return { type: 'canceled', reason: response.reason, requestId };
  }

  processFailedResponse(
    response: Extract<OpenAIFetcher.ConversationResponse, { type: 'failed' } | { type: 'failedDependency' }>,
    requestId: string
  ): ChatMLFetcher.FailedResponse {
    if (response && response.reason.includes('filtered as off_topic by intent classifier')) {
      return { type: 'offTopic', reason: response.reason, requestId };
    } else {
      if (response?.reason.includes('model is not supported')) {
        return { type: 'model_not_supported', reason: response.reason, requestId };
      } else {
        return {
          type: 'failed',
          reason: response.reason,
          requestId,
          code: response.type === 'failed' ? response.code : undefined,
        };
      }
    }
  }

  processError(err: Error, requestId: string): ChatMLFetcher.CanceledResponse | ChatMLFetcher.FailedResponse {
    if (isAbortError(err)) {
      return { type: 'canceled', reason: 'network request aborted', requestId };
    } else {
      conversationLogger.exception(this.ctx, err, 'Error on conversation request');
      return {
        type: 'failed',
        reason: 'Error on conversation request. Check the log for more details.',
        requestId,
      };
    }
  }
}

export { ChatMLFetcher };
