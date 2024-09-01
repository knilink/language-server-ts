import { CopilotAuthStatus } from "../auth/types.ts";

enum ErrorReasons {
  BadArguments = 'BadArgumentsError',
  Unauthorized = 'NotAuthorized',
  NotFound = 'NotFoundError',
  RateLimit = 'RateLimitError',
  InternalError = 'InternalError',
  ConnectionError = 'ConnectionError',
  Unknown = 'UnknownError',
}

const ErrorMessages = {
  [ErrorReasons.Unauthorized]:
    'Invalid GitHub token. Please sign out from your GitHub account using VSCode UI and try again',
  [ErrorReasons.InternalError]:
    'Internal error: matches to public code will not be detected. It is advised to disable Copilot completions until the service is reconnected.',
  [ErrorReasons.RateLimit]:
    "You've reached your quota and limit, code matching will be unavailable until the limit resets",
};

function getErrorType(code: number): ErrorReasons {
  if (code === 401) return ErrorReasons.Unauthorized;
  if (code === 400) return ErrorReasons.BadArguments;
  if (code === 404) return ErrorReasons.NotFound;
  if (code === 429) return ErrorReasons.RateLimit;
  if (code >= 500 && code < 600) return ErrorReasons.InternalError;
  if (code >= 600) return ErrorReasons.ConnectionError;
  return ErrorReasons.Unknown;
}

function createErrorResponse(code: number, msg: string, meta: { [key: string]: unknown } = {}): CopilotAuthStatus {
  return {
    kind: 'failure',
    reason: getErrorType(code),
    code,
    msg,
    meta,
  };
}

export { createErrorResponse, ErrorReasons, ErrorMessages, getErrorType };
