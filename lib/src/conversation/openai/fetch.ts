import { OpenAIFetcher } from '../../openai/fetch.ts';
import { type CancellationToken } from '../../../../agent/src/cancellation.ts';
import { type Context } from '../../context.ts';
import { StatusReporter } from '../../progress.ts';
import { TelemetryData, telemetry, now, TelemetryWithExp } from '../../telemetry.ts';
import { extractEngineName, getRequestId, getProcessingTime } from '../../openai/fetch.ts';
import { uiKindToIntent, logEngineMessages } from '../telemetry.ts';
import { postRequest, isAbortError, type Response } from '../../networking.ts';
import { Features } from '../../experiments/features.ts';
import { SSEProcessor } from '../../openai/stream.ts';
import { asyncIterableMap } from '../../common/iterableHelpers.ts';
import { prepareChatCompletionForReturn } from './stream.ts';
import { getMaxSolutionTokens, getTemperatureForSamples, getTopP } from '../../openai/openai.ts';
import { tryGetGitHubNWO } from '../../prompt/repository.ts';
import { CopilotTokenManager } from '../../auth/copilotTokenManager.ts';
import { Logger, LogLevel } from '../../logger.ts';
import { Chat, TelemetryMeasurements, TelemetryProperties, UiKind } from '../../types.ts';

const logger = new Logger(LogLevel.INFO, 'fetchChat');

async function fetchWithInstrumentation(
  ctx: Context,
  messages: Chat.ElidableChatMessage[],
  engineUrl: string,
  endpoint: string,
  ourRequestId: string,
  request: Record<string, any>,
  secretKey: string,
  uiKind: UiKind,
  cancel: CancellationToken | undefined,
  telemetryProperties: TelemetryProperties,
  telemetryMeasurements: TelemetryMeasurements
): Promise<Response | undefined> {
  const statusReporter = ctx.get(StatusReporter);
  const uri = `${engineUrl}/${endpoint}`;

  if (!secretKey) {
    logger.error(ctx, `Failed to send request to ${uri} due to missing key`);
    return;
  }

  let telemetryData = TelemetryData.createAndMarkAsIssued({
    endpoint: endpoint,
    engineName: extractEngineName(ctx, engineUrl),
    uiKind,
  });

  telemetryData = telemetryData.extendedBy(telemetryProperties, telemetryMeasurements);

  for (const [key, value] of Object.entries(request)) {
    if (key !== 'messages') {
      telemetryData.properties[`request.option.${key}`] = JSON.stringify(value) ?? 'undefined';
    }
  }

  telemetryData.properties.headerRequestId = ourRequestId;
  telemetry(ctx, 'request.sent', telemetryData);

  const requestStart = now();
  const intent = uiKindToIntent(uiKind);

  try {
    const response = await postRequest(ctx, uri, secretKey, intent, ourRequestId, request, cancel);
    const modelRequestId = getRequestId(response, undefined);
    telemetryData.extendWithRequestId(modelRequestId);

    const totalTimeMs = now() - requestStart;
    logger.info(ctx, `request.response: [${uri}] took ${totalTimeMs} ms`);
    logger.debug(ctx, 'request.response properties', telemetryData.properties);
    logger.debug(ctx, 'request.response measurements', telemetryData.measurements);
    logger.debug(ctx, 'messages:', JSON.stringify(messages));
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
    logEngineMessages(ctx, messages, telemetryData);
  }
}

class OpenAIChatMLFetcher {
  async fetchAndStreamChat(
    ctx: Context,
    params: OpenAIFetcher.ConversationParams,
    baseTelemetryData: TelemetryData,
    finishedCb: SSEProcessor.FinishedCb,
    cancel?: CancellationToken
  ): Promise<OpenAIFetcher.ConversationResponse> {
    const statusReporter = ctx.get(StatusReporter);
    const response = await this.fetchWithParameters(
      ctx,
      params.endpoint,
      params,
      cancel,
      baseTelemetryData.properties,
      baseTelemetryData.measurements
    );

    if (response === 'not-sent') return { type: 'canceled', reason: 'before fetch request' };
    if (cancel?.isCancellationRequested) {
      // const body = await response.body(); MARK
      const body = await response?.body();
      try {
        body?.destroy();
      } catch (e) {
        logger.exception(ctx, e, 'Error destroying stream');
      }
      return { type: 'canceled', reason: 'after fetch request' };
    }
    if (response === undefined) {
      const telemetryData = this.createTelemetryData(params.endpoint, ctx, params);
      statusReporter.setWarning();
      telemetryData.properties.error = 'Response was undefined';
      telemetry(ctx, 'request.shownWarning', telemetryData);
      return { type: 'failed', reason: 'fetch response was undefined', code: -1 };
    }
    if (response.status !== 200) {
      const telemetryData = this.createTelemetryData(params.endpoint, ctx, params);
      return this.handleError(ctx, statusReporter, telemetryData, response);
    }

    const fallbackFilters = await ctx.get(Features).getFallbackExpAndFilters();
    const baseTelemetryWithExp = new TelemetryWithExp(
      baseTelemetryData.properties,
      baseTelemetryData.measurements,
      baseTelemetryData.issuedTime,
      fallbackFilters
    );
    const finishedCompletions = (
      await SSEProcessor.create(ctx, params.count, response, baseTelemetryWithExp, [], cancel)
    ).processSSE(finishedCb);

    return {
      type: 'success',
      chatCompletions: asyncIterableMap(finishedCompletions, async (solution) =>
        prepareChatCompletionForReturn(ctx, solution, baseTelemetryData)
      ),
      getProcessingTime: () => getProcessingTime(response),
    };
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
    cancel: CancellationToken | undefined,
    telemetryProperties: TelemetryProperties,
    telemetryMeasurements: TelemetryMeasurements
  ): Promise<'not-sent' | Response | undefined> {
    const request: Partial<OpenAIFetcher.ConversationRequest> = {
      messages: params.messages,
      tools: params.tools,
      tool_choice: params.tool_choice,
      model: params.model,
      max_tokens: getMaxSolutionTokens(ctx),
      temperature: getTemperatureForSamples(ctx, params.count),
      top_p: getTopP(ctx),
      n: params.count,
      stop: ['\n\n\n'],
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
          cancel,
          telemetryProperties,
          telemetryMeasurements
        );
  }

  async handleError(
    ctx: Context,
    statusReporter: StatusReporter,
    telemetryData: TelemetryData,
    response: Response
  ): Promise<OpenAIFetcher.ConversationResponse> {
    statusReporter.setWarning();
    telemetryData.properties.error = `Response status was ${response.status}`;
    telemetryData.properties.status = String(response.status);
    telemetry(ctx, 'request.shownWarning', telemetryData);

    if (response.status === 401) {
      try {
        const text = await response.text();
        const json = JSON.parse(text);
        if (json.authorize_url) return { type: 'authRequired', reason: 'not authorized', authUrl: json.authorize_url };
      } catch {}
    } else if (response.status === 401 || response.status === 403) {
      ctx.get(CopilotTokenManager).resetCopilotToken(ctx, response.status);
      return { type: 'failed', reason: `token expired or invalid: ${response.status}`, code: response.status };
    } else if (response.status === 499) {
      logger.info(ctx, 'Cancelled by server');
      return { type: 'failed', reason: 'canceled by server', code: response.status };
    }

    const text = await response.text();
    if (response.status === 466) {
      statusReporter.setError(text);
      logger.info(ctx, text);
      return { type: 'failed', reason: `client not supported: ${text}`, code: response.status };
    } else if (response.status === 400 && text.includes('off_topic')) {
      return {
        type: 'failed',
        reason: 'filtered as off_topic by intent classifier: message was not programming related',
        code: response.status,
      };
    } else {
      logger.error(ctx, 'Unhandled status from server:', response.status, text);
      return {
        type: 'failed',
        reason: `unhandled status from server: ${response.status} ${text}`,
        code: response.status,
      };
    }
  }
}

export { OpenAIChatMLFetcher };
