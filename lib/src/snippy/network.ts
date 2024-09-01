import { CopilotAuthStatus } from "../auth/types.ts";
import { type Context } from "../context.ts";

import { CopilotTokenManager } from "../auth/copilotTokenManager.ts";
import { ConnectionState } from "./connectionState.ts";
import { createErrorResponse, getErrorType, ErrorReasons, ErrorMessages } from "./errorCreator.ts";
import { codeReferenceLogger } from "./logger.ts";
import { Fetcher, Request, Response } from "../networking.ts";
import { NetworkConfiguration } from "../networkConfiguration.ts";
import { editorVersionHeaders } from "../config.ts";
import { snippyTelemetry } from "./telemetryHandlers.ts";

const TWIRP_URL = 'twirp/github.snippy.v1.SnippyAPI';

async function call(
  ctx: Context,
  endpoint: string,
  config: Extract<Request, { method: 'POST'; json?: never }> | Extract<Request, { method?: 'GET' }>,
  signal?: AbortSignal
): Promise<CopilotAuthStatus> {
  let token: string | undefined;
  try {
    token = (await ctx.get(CopilotTokenManager).getCopilotToken(ctx)).token;
  } catch (error: unknown) {
    ConnectionState.setDisconnected();
    return createErrorResponse(401, ErrorMessages[ErrorReasons.Unauthorized]);
  }
  codeReferenceLogger.info(ctx, `Calling ${endpoint}`);
  if (ConnectionState.isRetrying()) {
    return createErrorResponse(600, 'Attempting to reconnect to the public code matching service.');
  }

  if (ConnectionState.isDisconnected()) {
    return createErrorResponse(601, 'The public code matching service is offline.');
  }

  let res: Response;
  try {
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...editorVersionHeaders(ctx),
    };
    res = await ctx.get(Fetcher).fetch(
      ctx.get(NetworkConfiguration).getOriginTrackingUrl(ctx, `${TWIRP_URL}/${endpoint}`),
      config.method === 'POST'
        ? {
          method: 'POST',
          body: JSON.stringify(config.body),
          headers,
          signal,
        }
        : {
          method: 'GET',
          headers,
          signal,
        }
    );
  } catch (error: unknown) {
    ConnectionState.enableRetry(ctx);
    return createErrorResponse(602, 'Network error detected. Check your internet connection.');
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch (error: unknown) {
    const message = (error as Error).message;
    snippyTelemetry.handleUnexpectedError({ context: ctx, origin: 'snippyNetwork', reason: message });
    throw error;
  }

  if (res.ok) return { kind: 'success', ...payload };

  // const errorPayload = { ...payload, code: Number(res.status) };
  // const { code, msg, meta }: { code: number; msg?: string; meta?: Record<string, unknown> } = errorPayload;
  // const formattedCode = Number(code);
  // const errorTypeFromCode = getErrorType(formattedCode);
  const { msg, meta } = payload;
  const code = Number(res.status);
  const errorTypeFromCode = getErrorType(code);
  const fallbackMsg = msg || 'unknown error';

  switch (errorTypeFromCode) {
    case ErrorReasons.Unauthorized:
      return createErrorResponse(code, ErrorMessages[ErrorReasons.Unauthorized], meta);
    case ErrorReasons.BadArguments:
      return createErrorResponse(code, fallbackMsg, meta);
    case ErrorReasons.RateLimit:
      ConnectionState.enableRetry(ctx, 60_000);
      return createErrorResponse(code, ErrorMessages[ErrorReasons.RateLimit], meta);
    case ErrorReasons.InternalError:
      ConnectionState.enableRetry(ctx);
      return createErrorResponse(code, ErrorMessages[ErrorReasons.InternalError], meta);
    default:
      return createErrorResponse(code, fallbackMsg, meta);
  }
}

export { call };
