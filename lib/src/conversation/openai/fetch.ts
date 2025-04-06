import type { OpenAIFetcher } from '../../openai/fetch.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../context.ts';
import type { TelemetryWithExp } from '../../telemetry.ts';
import type { Response } from '../../networking.ts';
import type { Chat, UiKind } from '../../types.ts';

// import * as util from 'util';
import { prepareChatCompletionForReturn } from './stream.ts';
import { logEngineMessages, uiKindToIntent } from '../telemetry.ts';
import { CopilotTokenManager } from '../../auth/copilotTokenManager.ts';
import { asyncIterableMap } from '../../common/iterableHelpers.ts';
import { Logger } from '../../logger.ts';
import { isAbortError, postRequest } from '../../networking.ts';
import { extractEngineName, getProcessingTime, getRequestId } from '../../openai/fetch.ts';
import { getTemperatureForSamples, getTopP } from '../../openai/openai.ts';
import { SSEProcessor } from '../../openai/stream.ts';
import { tryGetGitHubNWO } from '../../prompt/repository.ts';
import { TelemetryData, now, telemetry } from '../../telemetry.ts';
import { getKey } from '../../util/unknown.ts';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletion } from './openai.ts';

const logger = new Logger('fetchChat');

async function fetchWithInstrumentation(
  ctx: Context,
  messages: Chat.ElidableChatMessage[],
  engineUrl: string,
  endpoint: string,
  ourRequestId: string,
  request: Record<string, any>,
  secretKey: string,
  uiKind: UiKind,
  telemetryWithExp: TelemetryWithExp,
  cancel: CancellationToken | undefined
): Promise<Response> {
  // const uri = util.format('%s/%s', engineUrl, endpoint);
  // EDITED
  const uri = `${engineUrl}/${endpoint}`;

  if (!secretKey) throw new Error(`Failed to send request to ${uri} due to missing key`);

  const extendedTelemetryWithExp = telemetryWithExp.extendedBy({
    endpoint: endpoint,
    engineName: extractEngineName(ctx, engineUrl),
    uiKind,
  });

  for (const [key, value] of Object.entries(request)) {
    if (key !== 'messages') {
      extendedTelemetryWithExp.properties[`request.option.${key}`] = JSON.stringify(value) ?? 'undefined';
    }
  }
  extendedTelemetryWithExp.properties.headerRequestId = ourRequestId;
  telemetry(ctx, 'request.sent', extendedTelemetryWithExp);

  const requestStart = now();
  const intent = uiKindToIntent(uiKind);

  try {
    const response = await postRequest(ctx, uri, secretKey, intent, ourRequestId, request, cancel);
    const modelRequestId = getRequestId(response, undefined);
    extendedTelemetryWithExp.extendWithRequestId(modelRequestId);

    const totalTimeMs = now() - requestStart;
    extendedTelemetryWithExp.measurements.totalTimeMs = totalTimeMs;

    logger.info(ctx, `request.response: [${uri}] took ${totalTimeMs} ms`);
    logger.debug(ctx, 'request.response properties', extendedTelemetryWithExp.properties);
    logger.debug(ctx, 'request.response measurements', extendedTelemetryWithExp.measurements);
    logger.debug(ctx, 'messages:', JSON.stringify(messages));
    telemetry(ctx, 'request.response', extendedTelemetryWithExp);

    return response;
  } catch (error: any) {
    if (isAbortError(error)) throw error;

    const warningTelemetry = extendedTelemetryWithExp.extendedBy({ error: 'Network exception' });

    telemetry(ctx, 'request.shownWarning', warningTelemetry);

    extendedTelemetryWithExp.properties.message = String(getKey(error, 'name') ?? '');
    extendedTelemetryWithExp.properties.code = String(getKey(error, 'code') ?? '');
    extendedTelemetryWithExp.properties.errno = String(getKey(error, 'errno') ?? '');
    extendedTelemetryWithExp.properties.type = String(getKey(error, 'type') ?? '');

    const totalTimeMs = now() - requestStart;
    extendedTelemetryWithExp.measurements.totalTimeMs = totalTimeMs;
    logger.debug(ctx, `request.response: [${uri}] took ${totalTimeMs} ms`);
    logger.debug(ctx, 'request.error properties', extendedTelemetryWithExp.properties);
    logger.debug(ctx, 'request.error measurements', extendedTelemetryWithExp.measurements);
    telemetry(ctx, 'request.error', extendedTelemetryWithExp);

    throw error;
  } finally {
    logEngineMessages(ctx, messages, extendedTelemetryWithExp);
  }
}

class OpenAIChatMLFetcher {
  async fetchAndStreamChat(
    ctx: Context,
    params: OpenAIFetcher.ConversationParams,
    baseTelemetryWithExp: TelemetryWithExp,
    finishedCb: SSEProcessor.FinishedCb,
    cancel?: CancellationToken
  ): Promise<OpenAIFetcher.ConversationResponse> {
    const response = await this.fetchWithParameters(ctx, params.endpoint, params, baseTelemetryWithExp, cancel);
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
      const telemetryData = this.createTelemetryData(params.endpoint, ctx, params);
      return this.handleError(ctx, telemetryData, response);
    }

    if (params.model === 'o1' || params.model === 'o1-mini') {
      const textResponse = await response.text();
      const jsonResponse = JSON.parse(textResponse);
      const message =
        jsonResponse.choices != null ? jsonResponse.choices[0].message : { role: 'assistant', content: '' };
      const requestId = response.headers.get('X-Request-ID') ?? uuidv4();
      const completion: ChatCompletion = {
        blockFinished: false,
        choiceIndex: 0,
        finishReason: 'stop',
        message,
        tokens: message.content.split(' '),
        requestId: {
          headerRequestId: requestId,
          completionId: jsonResponse.id ? jsonResponse.id : '',
          created: jsonResponse.created ? Number(jsonResponse.created) : 0,
          deploymentId: '',
          serverExperiments: '',
        },
        telemetryData: baseTelemetryWithExp,
        numTokens: 0,
      };
      const text = message.content;
      await finishedCb(text, { text, copilotReferences: jsonResponse.copilot_references });
      return {
        type: 'success',
        chatCompletions: (async function* () {
          yield completion;
        })(),
        getProcessingTime: () => getProcessingTime(response),
      };
    } else {
      const finishedCompletions = SSEProcessor.create(
        ctx,
        params.count,
        response,
        baseTelemetryWithExp,
        [],
        cancel
      ).processSSE(finishedCb);
      return {
        type: 'success',
        chatCompletions: asyncIterableMap(finishedCompletions, async (solution) =>
          prepareChatCompletionForReturn(ctx, solution, baseTelemetryWithExp)
        ),
        getProcessingTime: () => getProcessingTime(response),
      };
    }
  }

  createTelemetryData(endpoint: string, ctx: Context, params: OpenAIFetcher.ConversationParams): TelemetryData {
    return TelemetryData.createAndMarkAsIssued({
      endpoint: endpoint,
      engineName: extractEngineName(ctx, params.engineUrl),
      uiKind: params.uiKind,
      headerRequestId: params.ourRequestId,
    });
  }

  async fetchWithParameters(
    ctx: Context,
    endpoint: string,
    params: OpenAIFetcher.ConversationParams,
    telemetryWithExp: TelemetryWithExp,
    cancel: CancellationToken | undefined
  ): Promise<'not-sent' | Response> {
    let request: Partial<OpenAIFetcher.ConversationRequest> = {
      messages: params.messages,
      tools: params.tools,
      tool_choice: params.tool_choice,
      model: params.model,
      temperature: getTemperatureForSamples(ctx, params.count),
      top_p: getTopP(ctx),
      n: params.count,
      stop: ['\n\n\n'],
      copilot_thread_id: params.copilot_thread_id,
    };

    const githubNWO = tryGetGitHubNWO(params.repoInfo);
    if (githubNWO !== undefined) request.nwo = githubNWO;
    if (params.postOptions) Object.assign(request, params.postOptions);
    if (params.intent) {
      request.intent = params.intent;
      if (params.intent_model) request.intent_model = params.intent_model;
      if (params.intent_tokenizer) request.intent_tokenizer = params.intent_tokenizer;
      if (params.intent_threshold) request.intent_threshold = params.intent_threshold;
      if (params.intent_content) request.intent_content = params.intent_content;
    }

    if (params.model === 'o1' || params.model === 'o1-mini') {
      // Object.keys(request).forEach((key) => {
      //   if (key !== 'model' && key !== 'stream' && key !== 'messages') {
      //     delete request[key];
      //   }
      // });
      //
      // request.stream = false;

      // EDITED
      request = {
        model: request.model,
        messages: request.messages,
        stream: false,
      };
    }

    return cancel?.isCancellationRequested
      ? 'not-sent'
      : fetchWithInstrumentation(
          ctx,
          params.messages,
          params.engineUrl,
          endpoint,
          params.ourRequestId,
          request,
          params.authToken,
          params.uiKind,
          telemetryWithExp,
          cancel
        );
  }

  async handleError(
    ctx: Context,
    telemetryData: TelemetryData,
    response: Response
  ): Promise<OpenAIFetcher.ConversationResponse> {
    if (response.clientError && !response.headers.get('x-github-request-id')) {
      {
        let message = `Last response was a ${response.status} error and does not appear to originate from GitHub. Is a proxy or firewall intercepting this request? https://gh.io/copilot-firewall`;
        logger.error(ctx, message);
        telemetryData.properties.error = `Response status was ${response.status} with no x-github-request-id header`;
      }
    } else {
      telemetryData.properties.error = `Response status was ${response.status}`;
    }

    telemetryData.properties.status = String(response.status);
    telemetry(ctx, 'request.shownWarning', telemetryData);

    if (response.status === 401) {
      try {
        const text = await response.text();
        const json = JSON.parse(text);
        if (json.authorize_url) return { type: 'authRequired', reason: 'not authorized', authUrl: json.authorize_url };
      } catch {}
    } else if (response.status === 401 || response.status === 403) {
      ctx.get(CopilotTokenManager).resetToken(response.status);
      return { type: 'failed', reason: `token expired or invalid: ${response.status}`, code: response.status };
    } else if (response.status === 499) {
      logger.info(ctx, 'Cancelled by server');
      return { type: 'failed', reason: 'canceled by server', code: response.status };
    }

    const text = await response.text();
    if (response.status === 466) {
      logger.info(ctx, text);
      return { type: 'failed', reason: `client not supported: ${text}`, code: response.status };
    }
    if (response.status === 400 && text.includes('off_topic')) {
      return {
        type: 'failed',
        reason: 'filtered as off_topic by intent classifier: message was not programming related',
        code: response.status,
      };
    }
    if (response.status === 400 && text.includes('model_not_supported')) {
      return { type: 'failed', reason: 'model is not supported.', code: response.status };
    }
    if (response.status === 424) {
      return { type: 'failedDependency', reason: text };
    }
    if (response.status === 402) {
      let retryAfter = response.headers.get('retry-after');
      return {
        type: 'failed',
        reason: retryAfter
          ? `You've reached your monthly chat messages limit. Upgrade to Copilot Pro (30-day free trial) or wait until ${new Date(retryAfter).toLocaleString()} for your limit to reset.`
          : "You've reached your monthly chat messages limit. Upgrade to Copilot Pro (30-day free trial) or wait for your limit to reset.",
        code: response.status,
      };
    }
    logger.error(ctx, 'Unhandled status from server:', response.status, text);
    return {
      type: 'failed',
      reason: `unhandled status from server: ${response.status} ${text}`,
      code: response.status,
    };
  }
}

export { OpenAIChatMLFetcher };
