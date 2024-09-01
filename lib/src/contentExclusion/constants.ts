import type { DocumentEvaluateResult } from "../types.ts";
import { Logger, LogLevel } from "../logger.ts";

const NOT_BLOCKED_RESPONSE: DocumentEvaluateResult = { isBlocked: false, reason: 'VALID_FILE' };

const NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE: DocumentEvaluateResult = {
  isBlocked: false,
  reason: 'NO_MATCHING_POLICY',
};

const BLOCKED_POLICY_ERROR_RESPONSE: DocumentEvaluateResult = {
  isBlocked: true,
  reason: 'POLICY_ERROR',
  message: 'Copilot is disabled because we could not fetch the repository policy',
};

const logger = new Logger(LogLevel.INFO, 'contentExclusion');

export { NOT_BLOCKED_RESPONSE, NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE, BLOCKED_POLICY_ERROR_RESPONSE, logger };
