import type { DocumentEvaluateResult } from '../types.ts';
import { Logger } from '../logger.ts';

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
const SCOPES = { all: 'all' as 'all', repo: 'repo' as 'repo' };
const logger = new Logger('contentExclusion');

export { BLOCKED_POLICY_ERROR_RESPONSE, NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE, NOT_BLOCKED_RESPONSE, SCOPES, logger };
