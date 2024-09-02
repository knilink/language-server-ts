import * as util from 'util';
import {
  Choice,
  OpenAIRequestId,
  TelemetryProperties,
  JsonData,
  UiKind,
  FetchResult,
  Chat,
  ToolCall,
  Tool,
} from '../types.ts';
import { Prompt } from '../../../prompt/src/types.ts';
import { CancellationToken } from '../../../agent/src/cancellation.ts';

import { Context } from '../context.ts';

import { RepoInfo, tryGetGitHubNWO } from '../prompt/repository.ts';
import { getMaxSolutionTokens, getTemperatureForSamples, getTopP, getStops, APIChoice } from './openai.ts';
import { type ChatCompletion } from '../conversation/openai/openai.ts';
import { asyncIterableFilter, asyncIterableMap } from '../common/iterableHelpers.ts';
import { logger } from '../logger.ts';
import {
  TelemetryData,
  telemetrizePromptLength,
  telemetry,
  now,
  logEnginePrompt,
  TelemetryWithExp,
} from '../telemetry.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { Request, Response, postRequest, isAbortError } from '../networking.ts';
import { Features } from '../experiments/features.ts';
import { SSEProcessor, prepareSolutionForReturn } from './stream.ts';
import { StatusReporter } from '../progress.ts';

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
  secretKey?: string,
  uiKind?: UiKind,
  cancel?: CancellationToken,
  telemetryProperties?: TelemetryProperties,
  headers?: Record<string, string>
): Promise<Response> {
  const statusReporter = ctx.get(StatusReporter);
  const uri = util.format('%s/%s', engineUrl, endpoint);
  if (!secretKey) {
    logger.error(ctx, `Failed to send request to ${uri} due to missing key`);
    return Promise.reject(new Error('Secret key is missing'));
  }
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
    const response: Response = await postRequest(ctx, uri, secretKey, intent, ourRequestId, request, cancel, headers);
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
    statusReporter.setWarning(error.message);
    const warningTelemetry = telemetryData.extendedBy({ error: 'Network exception' });
    telemetry(ctx, 'request.shownWarning', warningTelemetry);
    telemetryData.properties.message = String(error.name ?? '');
    telemetryData.properties.code = String(error.code ?? '');
    telemetryData.properties.errno = String(error.errno ?? '');
    telemetryData.properties.type = String(error.type ?? '');
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
  };

  // ../conversation/openai/fetch.ts
  export type ConversationParams = Pick<
    ConversationRequest,
    | 'messages'
    | 'tool_choice'
    | 'model'
    | 'tools'
    | 'intent'
    | 'intent_model'
    | 'intent_tokenizer'
    | 'intent_threshold'
    | 'intent_content'
  > & {
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
        choices: AsyncIterable<APIChoice>;
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
}

abstract class OpenAIFetcher {
  abstract fetchAndStreamCompletions(
    ctx: Context,
    completionParams: OpenAIFetcher.CompletionParams,
    baseTelemetryData: TelemetryData,
    finishedCb: SSEProcessor.FinishedCb,
    cancellationToken: CancellationToken
  ): Promise<OpenAIFetcher.CompletionResponse>;
}

class LiveOpenAIFetcher extends OpenAIFetcher {
  async fetchAndStreamCompletions(
    ctx: Context,
    params: OpenAIFetcher.CompletionParams,
    baseTelemetryData: TelemetryWithExp,
    finishedCb: SSEProcessor.FinishedCb,
    cancel?: CancellationToken,
    telemetryProperties?: TelemetryProperties
  ): Promise<OpenAIFetcher.CompletionResponse> {
    let statusReporter = ctx.get(StatusReporter);
    const endpoint = 'completions';
    const response = await this.fetchWithParameters(
      ctx,
      endpoint,
      params,
      baseTelemetryData,
      cancel,
      telemetryProperties
    );
    if (response === 'not-sent') return { type: 'canceled', reason: 'before fetch request' };
    if (cancel?.isCancellationRequested) {
      const body = await response.body();
      try {
        body.destroy();
      } catch (e) {
        logger.exception(ctx, e, 'Error destroying stream');
      }
      return { type: 'canceled', reason: 'after fetch request' };
    }
    if (response === undefined) {
      let telemetryData = this.createTelemetryData(endpoint, ctx, params);
      statusReporter.setWarning();
      telemetryData.properties.error = 'Response was undefined';
      telemetry(ctx, 'request.shownWarning', telemetryData);
      return { type: 'failed', reason: 'fetch response was undefined' };
    }
    if (response.status !== 200) {
      let telemetryData = this.createTelemetryData(endpoint, ctx, params);
      return this.handleError(ctx, statusReporter, telemetryData, response);
    }
    const dropCompletionReasons = ctx.get(Features).dropCompletionReasons(baseTelemetryData);
    const finishedCompletions = (
      await SSEProcessor.create(ctx, params.count, response, baseTelemetryData, dropCompletionReasons, cancel)
    ).processSSE(finishedCb);
    const choices: AsyncIterable<APIChoice> = asyncIterableMap(finishedCompletions, async (solution) =>
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
          (await ctx.get(CopilotTokenManager).getCopilotToken(ctx)).token,
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
    response: Response
  ): Promise<{ type: 'failed'; reason: string }> {
    statusReporter.setWarning();
    telemetryData.properties.error = `Response status was ${response.status}`;
    telemetryData.properties.status = String(response.status);
    telemetry(ctx, 'request.shownWarning', telemetryData);

    if (response.status === 401 || response.status === 403) {
      ctx.get(CopilotTokenManager).resetCopilotToken(ctx, response.status);
      return { type: 'failed', reason: `token expired or invalid: ${response.status}` };
    }

    if (response.status === 499) {
      logger.info(ctx, 'Cancelled by server');
      return { type: 'failed', reason: 'canceled by server' };
    }

    const text = await response.text();
    if (response.status === 466) {
      statusReporter.setError(text);
      logger.info(ctx, text);
      return { type: 'failed', reason: `client not supported: ${text}` };
    } else {
      logger.error(ctx, 'Unhandled status from server:', response.status, text);
      return { type: 'failed', reason: `unhandled status from server: ${response.status} ${text}` };
    }
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
