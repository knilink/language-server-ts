import { Context } from '../context';

import { TelemetryData, telemetry, telemetryError } from '../telemetry';
import { codeReferenceLogger } from './logger';

const statusCodeRe = /^[1-6][0-9][0-9]$/;
const capitalsRe = /([A-Z][a-z]+)/;
const NAMESPACE = 'code_referencing';

class CodeQuoteTelemetry {
  constructor(readonly baseKey: string) { }

  buildKey(...keys: string[]): string {
    return [NAMESPACE, this.baseKey, ...keys].join('.');
  }
}

class CopilotOutputLogTelemetry extends CodeQuoteTelemetry {
  constructor() {
    super('github_copilot_log');
  }

  handleOpen({ context }: { context: Context }): void {
    const data = TelemetryData.createAndMarkAsIssued();
    const key = this.buildKey('open', 'count');
    telemetry(context, key, data);
  }

  handleFocus({ context }: { context: Context }): void {
    const data = TelemetryData.createAndMarkAsIssued();
    const key = this.buildKey('focus', 'count');
    telemetry(context, key, data);
  }

  handleWrite({ context }: { context: Context }): void {
    const data = TelemetryData.createAndMarkAsIssued();
    const key = this.buildKey('write', 'count');
    telemetry(context, key, data);
  }
}

const copilotOutputLogTelemetry = new CopilotOutputLogTelemetry();

class MatchNotificationTelemetry extends CodeQuoteTelemetry {
  constructor() {
    super('match_notification');
  }

  handleDoAction({ context, actor }: { context: Context; actor: string }): void {
    const data = TelemetryData.createAndMarkAsIssued({ actor });
    const key = this.buildKey('acknowledge', 'count');
    telemetry(context, key, data);
  }

  handleDismiss({ context, actor }: { context: Context; actor: string }): void {
    const data = TelemetryData.createAndMarkAsIssued({ actor });
    const key = this.buildKey('ignore', 'count');
    telemetry(context, key, data);
  }
}

const matchNotificationTelemetry = new MatchNotificationTelemetry();

class SnippyTelemetry extends CodeQuoteTelemetry {
  constructor() {
    super('snippy');
  }

  handleUnexpectedError({ context, origin, reason }: { context: Context; origin: string; reason: string }): void {
    const data = TelemetryData.createAndMarkAsIssued({ origin, reason });
    telemetryError(context, this.buildKey('unexpectedError'), data);
  }

  handleCompletionMissing({ context, origin, reason }: { context: Context; origin: string; reason: string }): void {
    const data = TelemetryData.createAndMarkAsIssued({ origin, reason });
    telemetryError(context, this.buildKey('completionMissing'), data);
  }

  handleSnippyNetworkError({
    context,
    origin,
    reason,
    message,
  }: {
    context: Context;
    origin: string;
    reason: string;
    message: string;
  }): void {
    if (!origin.match(statusCodeRe)) {
      codeReferenceLogger.debug(context, 'Invalid status code, not sending telemetry', { origin });
      return;
    }
    const errorType = reason
      .split(capitalsRe)
      .filter((part: string) => !!part)
      .join('_')
      .toLowerCase();
    const data = TelemetryData.createAndMarkAsIssued({ message });
    telemetryError(context, this.buildKey(errorType, origin), data);
  }
}

const snippyTelemetry = new SnippyTelemetry();

export { copilotOutputLogTelemetry, matchNotificationTelemetry, snippyTelemetry };
