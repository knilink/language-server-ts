import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { OpenAIRequestId, TelemetryProperties, JsonData, UiKind, Chat, Tool, RepoInfo } from '../types.ts';
import type { Prompt } from '../../../prompt/src/types.ts';
import type { Context } from '../context.ts';
import type { ChatCompletion } from '../conversation/openai/openai.ts';
import type { CopilotToken } from '../auth/copilotToken.ts';
import type { APIChoice } from './openai.ts';
import type { TelemetryWithExp } from '../telemetry.ts';
import type { Response } from '../networking.ts';

import * as util from 'util';
import { getMaxSolutionTokens, getStops, getTemperatureForSamples, getTopP } from './openai.ts';
import { SSEProcessor, prepareSolutionForReturn } from './stream.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { onCopilotToken } from '../auth/copilotTokenNotifier.ts';
import { asyncIterableFilter, asyncIterableMap } from '../common/iterableHelpers.ts';
import { Features } from '../experiments/features.ts';
import { Logger } from '../logger.ts';
import { isAbortError, postRequest } from '../networking.ts';
import { StatusReporter } from '../progress.ts';
import { tryGetGitHubNWO } from '../prompt/repository.ts';
import { TelemetryData, logEnginePrompt, now, telemetrizePromptLength, telemetry } from '../telemetry.ts';
import { getKey } from '../util/unknown.ts';
import { v4 as uuidv4 } from 'uuid';

function getRequestId(response: Response, json?: JsonData): OpenAIRequestId {
  return {
    headerRequestId: response.headers.get('x-request-id') || '',
    completionId: json && json.id ? json.id : '',
    created: json && json.created ? json.created : 0,
    serverExperiments: response.headers.get('X-Copilot-Experiment') || '',
    deploymentId: response.headers.get('azureml-model-deployment') || '',
  };
}

function getProcessingTime(response: Response) {
  let reqIdStr = response.headers.get('openai-processing-ms');
  return reqIdStr ? parseInt(reqIdStr, 10) : 0;
}

function extractEngineName(ctx: Context, engineUrl: string) {
  let engineName = engineUrl.split('/').pop();
  if (engineName) {
    return engineName;
  }
  logger.error(ctx, 'Malformed engine URL: ' + engineUrl);
  return engineUrl;
}

function uiKindToIntent(uiKind?: UiKind): 'copilot-ghost' | 'copilot-panel' | undefined {
  switch (uiKind) {
    case 'ghostText':
      return 'copilot-ghost';
    case 'synthesize':
      return 'copilot-panel';
  }
}

async function fetchWithInstrumentation(
  ctx: Context,
  prompt: Prompt,
  engineUrl: string,
  endpoint: string,
  ourRequestId: string,
  request: Record<string, unknown>,
  copilotToken: CopilotToken,
  uiKind?: UiKind,
  cancel?: CancellationToken,
  telemetryProperties?: TelemetryProperties,
  headers?: Record<string, string>
): Promise<Response> {
  const statusReporter = ctx.get(StatusReporter);
  const uri = util.format('%s/%s', engineUrl, endpoint);
  let telemetryData = TelemetryData.createAndMarkAsIssued(
    { endpoint, engineName: extractEngineName(ctx, engineUrl), ...(uiKind !== undefined ? { uiKind } : {}) },
    telemetrizePromptLength(prompt)
  );
  if (telemetryProperties) {
    telemetryData = telemetryData.extendedBy(telemetryProperties);
  }
  for (const [key, value] of Object.entries(request)) {
    if (key === 'prompt' || key === 'suffix') continue;
    const stringifiedValue = JSON.stringify(value) ?? 'undefined';
    telemetryData.properties[`request.option.${key}`] = stringifiedValue;
  }
  telemetryData.properties.headerRequestId = ourRequestId;
  telemetry(ctx, 'request.sent', telemetryData);
  const requestStart = now();
  const intent = uiKindToIntent(uiKind);
  try {
    const response: Response = await postRequest(
      ctx,
      uri,
      copilotToken.token,
      intent,
      ourRequestId,
      request,
      cancel,
      headers
    );
    const modelRequestId = getRequestId(response, undefined);
    telemetryData.extendWithRequestId(modelRequestId);
    const totalTimeMs = now() - requestStart;
    telemetryData.measurements.totalTimeMs = totalTimeMs;
    logger.info(ctx, `request.response: [${uri}] took ${totalTimeMs} ms`);
    logger.debug(ctx, 'request.response properties', telemetryData.properties);
    logger.debug(ctx, 'request.response measurements', telemetryData.measurements);
    logger.debug(ctx, 'prompt:', prompt);
    telemetry(ctx, 'request.response', telemetryData);
    return response;
  } catch (error: any) {
    if (isAbortError(error)) throw error;
    // EDITED, wrapping String(...)
    statusReporter.setWarning(String(getKey(error, 'message') ?? ''));
    const warningTelemetry = telemetryData.extendedBy({ error: 'Network exception' });
    telemetry(ctx, 'request.shownWarning', warningTelemetry);
    telemetryData.properties.message = String(getKey(error, 'name') ?? '');
    telemetryData.properties.code = String(getKey(error, 'code') ?? '');
    telemetryData.properties.errno = String(getKey(error, 'errno') ?? '');
    telemetryData.properties.type = String(getKey(error, 'type') ?? '');
    const totalTimeMs = now() - requestStart;
    telemetryData.measurements.totalTimeMs = totalTimeMs;
    logger.debug(ctx, `request.response: [${uri}] took ${totalTimeMs} ms`);
    logger.debug(ctx, 'request.error properties', telemetryData.properties);
    logger.debug(ctx, 'request.error measurements', telemetryData.measurements);
    telemetry(ctx, 'request.error', telemetryData);
    throw error;
  } finally {
    logEnginePrompt(ctx, prompt, telemetryData);
  }
}

function postProcessChoices(choices: AsyncIterable<APIChoice>): AsyncGenerator<APIChoice> {
  return asyncIterableFilter(choices, async (choice) => choice.completionText.trim().length > 0);
}

const logger = new Logger('fetchCompletions');

namespace OpenAIFetcher {
  // ../conversation/skills/projectContextSnippetProviders/localSnippets/UserQueryParser.ts
  export type ToolChoice = {
    type: 'function';
    function: { name: string };
  };
  // ../conversation/openai/fetch.ts
  export type ConversationRequest = {
    messages: Chat.ElidableChatMessage[];
    tools?: Tool[];
    tool_choice?: ToolChoice | 'auto';
    model: string;
    max_tokens: number;
    temperature: number;
    top_p: number;
    n: number; // count
    stop: string[];
    intent?: unknown;
    intent_model?: unknown;
    intent_tokenizer?: unknown;
    intent_threshold?: unknown;
    intent_content?: unknown;
    nwo: string;
    // ../conversation/chatMLFetcher.ts
    stream: boolean;
    // ../conversation/chatMLFetcher.ts
    logit_bias: Record<number, number>;
    // ../conversation/openai/fetch.ts
    // optional ../conversation/chatMLFetcher.ts
    copilot_thread_id?: string;
  };

  // ../conversation/openai/fetch.ts
  export type ConversationParams = Pick<
    ConversationRequest,
    | 'messages'
    | 'tool_choice'
    | 'tools'
    | 'intent'
    | 'intent_model'
    | 'intent_tokenizer'
    | 'intent_threshold'
    | 'intent_content'
    | 'copilot_thread_id'
  > & {
    // optional ../conversation/chatMLFetcher.ts
    model?: string;
    endpoint: string;
    engineUrl: string;
    count: ConversationRequest['n'];
    postOptions?: Partial<ConversationRequest>;
    // undefined ../conversation/chatMLFetcher.ts
    repoInfo?: RepoInfo;
    ourRequestId: string;
    authToken: string;
    uiKind: UiKind;
  };

  // ../conversation/openai/fetch.ts
  export type ConversationResponse =
    | {
        type: 'success';
        chatCompletions: AsyncIterable<ChatCompletion>;
        getProcessingTime: () => number;
      }
    | {
        type: 'failed';
        reason: string;
        code: number;
      }
    | {
        type: 'failedDependency';
        reason: string;
        // no code ../conversation/openai/fetch.ts
        // code: number;
      }
    | {
        type: 'canceled';
        reason: string;
      }
    | {
        type: 'authRequired';
        reason: string;
        authUrl: string;
      };

  export type CompletionRequest = {
    prompt: string;
    suffix: string;
    max_tokens: number;
    temperature: number;
    top_p: number;
    n: number; // count
    stop: string[];
    logprobs: number;
    nwo: string;
    // [start] ../ghostText/ghostText.ts
    stream: boolean;
    extra: Partial<{
      language: string;
      next_indent: number;
      trim_by_indentation: boolean;
      prompt_tokens: number;
      suffix_tokens: number;
      // ../copilotPanel/panel.ts
      force_indent: number;
    }>;
    logit_bias: { [key: number]: number };
    // [end]
    speculation: string;
  };

  export type CompletionParams = {
    prompt: Prompt;
    engineUrl: string;
    ourRequestId: string;
    count: number;
    languageId: string;
    requestLogProbs?: boolean;
    postOptions?: Partial<CompletionRequest>;
    headers?: Record<string, string>;
    uiKind: UiKind;
    // ../ghostText/ghostText.ts computeInBackgroundAndMemoize not ready when it's 0
    repoInfo?: RepoInfo | 0;
  };

  export type CompletionResponse =
    | {
        type: 'success';
        choices: AsyncGenerator<APIChoice>;
        getProcessingTime: () => number;
      }
    | {
        type: 'failed';
        reason: string;
      }
    | {
        type: 'canceled';
        reason: string;
      };

  export interface SpeculationParams {
    engineUrl: string;
    prompt: string;
    speculation: string;
    temperature: number;
    stream: boolean;
    stops: string[];
    uiKind: UiKind;
    headers?: Record<string, string>;
  }
}

abstract class OpenAIFetcher {
  abstract fetchAndStreamCompletions(
    ctx: Context,
    completionParams: OpenAIFetcher.CompletionParams,
    baseTelemetryData: TelemetryData,
    finishedCb: SSEProcessor.FinishedCb,
    cancellationToken: CancellationToken
  ): Promise<OpenAIFetcher.CompletionResponse>;

  abstract fetchAndStreamSpeculation(
    ctx: Context,
    params: OpenAIFetcher.SpeculationParams,
    baseTelemetryData: TelemetryWithExp,
    finishedCb: SSEProcessor.FinishedCb,
    cancel: CancellationToken,
    telemetryProperties?: TelemetryProperties
  ): Promise<OpenAIFetcher.CompletionResponse>;
}

const CMDQuotaExceeded = 'github.copilot.completions.quotaExceeded';

class LiveOpenAIFetcher extends OpenAIFetcher {
  // explicitly private
  private _disabledReason?: string;
  async fetchAndStreamCompletions(
    ctx: Context,
    params: OpenAIFetcher.CompletionParams,
    baseTelemetryData: TelemetryWithExp,
    finishedCb: SSEProcessor.FinishedCb,
    cancel?: CancellationToken,
    telemetryProperties?: TelemetryProperties
  ): Promise<OpenAIFetcher.CompletionResponse> {
    if (this._disabledReason) {
      return { type: 'canceled', reason: this._disabledReason };
    }
    let statusReporter = ctx.get(StatusReporter);
    const endpoint = 'completions';
    const copilotToken = await ctx.get(CopilotTokenManager).getToken();
    const response = await this.fetchWithParameters(
      ctx,
      endpoint,
      params,
      copilotToken,
      baseTelemetryData,
      cancel,
      telemetryProperties
    );
    if (response === 'not-sent') return { type: 'canceled', reason: 'before fetch request' };
    if (cancel?.isCancellationRequested) {
      const body = response.body();
      try {
        body.destroy();
      } catch (e) {
        logger.exception(ctx, e, 'Error destroying stream');
      }
      return { type: 'canceled', reason: 'after fetch request' };
    }
    if (response.status !== 200) {
      let telemetryData = this.createTelemetryData(endpoint, ctx, params);
      return this.handleError(ctx, statusReporter, telemetryData, response, copilotToken);
    }
    const dropCompletionReasons = ctx.get(Features).dropCompletionReasons(baseTelemetryData);
    const finishedCompletions = SSEProcessor.create(
      ctx,
      params.count,
      response,
      baseTelemetryData,
      dropCompletionReasons,
      cancel
    ).processSSE(finishedCb);
    const choices = asyncIterableMap(finishedCompletions, async (solution) =>
      prepareSolutionForReturn(ctx, solution, baseTelemetryData)
    );
    return {
      type: 'success',
      choices: postProcessChoices(choices),
      getProcessingTime: () => getProcessingTime(response),
    };
  }

  async fetchAndStreamSpeculation(
    ctx: Context,
    params: OpenAIFetcher.SpeculationParams,
    baseTelemetryData: TelemetryWithExp,
    finishedCb: SSEProcessor.FinishedCb,
    cancel: CancellationToken,
    telemetryProperties?: TelemetryProperties
  ): Promise<OpenAIFetcher.CompletionResponse> {
    if (this._disabledReason) {
      return { type: 'canceled', reason: this._disabledReason };
    }
    const statusReporter = ctx.get(StatusReporter);
    const endpoint = 'speculation';
    const copilotToken = await ctx.get(CopilotTokenManager).getToken();
    const completionParams: OpenAIFetcher.CompletionParams = {
      prompt: { prefix: params.prompt, suffix: '', isFimEnabled: false, promptElementRanges: [] },
      postOptions: {
        speculation: params.speculation,
        temperature: params.temperature,
        stream: params.stream,
        stop: params.stops ?? [],
      },
      languageId: '',
      count: 0,
      repoInfo: undefined,
      ourRequestId: uuidv4(),
      engineUrl: params.engineUrl,
      uiKind: params.uiKind,
      headers: params.headers,
    };
    let response = await this.fetchWithParameters(
      ctx,
      endpoint,
      completionParams,
      copilotToken,
      baseTelemetryData,
      cancel,
      telemetryProperties
    );
    if (response === 'not-sent') {
      return { type: 'canceled', reason: 'before fetch request' };
    }
    if (cancel?.isCancellationRequested) {
      const body = response.body();
      try {
        body.destroy();
      } catch (e) {
        logger.exception(ctx, e, 'Error destroying stream');
      }
      return { type: 'canceled', reason: 'after fetch request' };
    }
    if (response.status !== 200) {
      let telemetryData = this.createTelemetryData(endpoint, ctx, completionParams);
      return this.handleError(ctx, statusReporter, telemetryData, response, copilotToken);
    }
    const dropCompletionReasons = ctx.get(Features).dropCompletionReasons(baseTelemetryData);
    const finishedCompletions = SSEProcessor.create(
      ctx,
      1,
      response,
      baseTelemetryData,
      dropCompletionReasons,
      cancel
    ).processSSE(finishedCb);
    const choices = asyncIterableMap(finishedCompletions, async (solution) =>
      prepareSolutionForReturn(ctx, solution, baseTelemetryData)
    );
    return {
      type: 'success',
      choices: postProcessChoices(choices),
      getProcessingTime: () => getProcessingTime(response),
    };
  }

  createTelemetryData(endpoint: string, ctx: Context, params: OpenAIFetcher.CompletionParams): TelemetryData {
    return TelemetryData.createAndMarkAsIssued({
      endpoint,
      engineName: extractEngineName(ctx, params.engineUrl),
      uiKind: params.uiKind,
      headerRequestId: params.ourRequestId,
    });
  }

  async fetchWithParameters(
    ctx: Context,
    endpoint: string,
    params: OpenAIFetcher.CompletionParams,
    copilotToken: CopilotToken,
    baseTelemetryData: TelemetryWithExp,
    cancel?: CancellationToken,
    telemetryProperties?: TelemetryProperties
  ): Promise<Response | 'not-sent'> {
    const disableLogProb = ctx.get(Features).disableLogProb(baseTelemetryData);
    const request: Partial<OpenAIFetcher.CompletionRequest> = {
      prompt: params.prompt.prefix,
      suffix: params.prompt.suffix,
      max_tokens: getMaxSolutionTokens(ctx),
      temperature: getTemperatureForSamples(ctx, params.count),
      top_p: getTopP(ctx),
      n: params.count,
      stop: getStops(ctx, params.languageId),
    };

    if (params.requestLogProbs || !disableLogProb) {
      request.logprobs = 2;
    }

    let githubNWO = tryGetGitHubNWO(params.repoInfo);
    if (githubNWO !== undefined) request.nwo = githubNWO;
    if (params.postOptions) Object.assign(request, params.postOptions);

    await new Promise((resolve, _reject) => {
      setImmediate(resolve);
    });

    return cancel?.isCancellationRequested
      ? 'not-sent'
      : fetchWithInstrumentation(
          ctx,
          params.prompt,
          params.engineUrl,
          endpoint,
          params.ourRequestId,
          request,
          copilotToken,
          params.uiKind,
          cancel,
          telemetryProperties,
          params.headers
        );
  }

  async handleError(
    ctx: Context,
    statusReporter: StatusReporter,
    telemetryData: TelemetryData,
    response: Response,
    copilotToken: CopilotToken
  ): Promise<{ type: 'failed'; reason: string }> {
    const text = await response.text();
    if (response.clientError && !response.headers.get('x-github-request-id')) {
      const message = `Last response was a ${response.status} error and does not appear to originate from GitHub. Is a proxy or firewall intercepting this request? https://gh.io/copilot-firewall`;
      logger.error(ctx, message);
      statusReporter.setWarning(message);
      telemetryData.properties.error = `Response status was ${response.status} with no x-github-request-id header`;
    } else if (response.clientError) {
      logger.warn(ctx, `Response status was ${response.status}:`, text);
      statusReporter.setWarning(`Last response was a ${response.status} error: ${text}`);
      telemetryData.properties.error = `Response status was ${response.status}: ${text}`;
    } else {
      statusReporter.setWarning(`Last response was a ${response.status} error`);
      telemetryData.properties.error = `Response status was ${response.status}`;
    }

    telemetryData.properties.status = String(response.status);
    telemetry(ctx, 'request.shownWarning', telemetryData);
    if (response.status === 401 || response.status === 403) {
      ctx.get(CopilotTokenManager).resetToken(response.status);
      return { type: 'failed', reason: `token expired or invalid: ${response.status}` };
    }
    if (response.status === 429) {
      setTimeout(() => {
        this._disabledReason = undefined;
      }, 10_000);
      this._disabledReason = 'rate limited';
      logger.warn(ctx, 'Rate limited by server. Denying completions for the next 10 seconds.');
      return { type: 'failed', reason: this._disabledReason };
    }
    if (response.status === 402) {
      this._disabledReason = 'monthly free code completions exhausted';
      statusReporter.setError('Completions limit reached', { command: CMDQuotaExceeded, title: 'Learn More' });
      let event = onCopilotToken(ctx, (t) => {
        this._disabledReason, undefined;

        if ((t.envelope.limited_user_quotas?.completions ?? 1) > 0) {
          statusReporter.forceNormal();
          event.dispose();
        }
      });
      return { type: 'failed', reason: this._disabledReason };
    }

    if (response.status === 499) {
      logger.info(ctx, 'Cancelled by server');
      return { type: 'failed', reason: 'canceled by server' };
    }

    if (response.status === 466) {
      statusReporter.setError(text);
      logger.info(ctx, text);
      return { type: 'failed', reason: `client not supported: ${text}` };
    }

    logger.error(ctx, 'Unhandled status from server:', response.status, text);
    return {
      type: 'failed',
      reason: `unhandled status from server: ${response.status} ${text}`,
    };
  }
}

export {
  getRequestId,
  OpenAIFetcher,
  postProcessChoices,
  fetchWithInstrumentation,
  getProcessingTime,
  extractEngineName,
  LiveOpenAIFetcher,
};
