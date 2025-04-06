import type { Context } from '../context.ts';
import type { TelemetryProperties, Completion } from '../types.ts';
import { CompletionResultType } from '../types.ts';
import type { GhostTextResult, Result } from './ghostText.ts';

import { ContextualFilterManager } from './contextualFilter.ts';
import { logger } from '../logger.ts';
import { now, telemetry, telemetryRaw, type TelemetryWithExp, type TelemetryData } from '../telemetry.ts';
import type {} from '../experiments/telemetryNames.ts';
import type {} from './ghostText.ts';

function telemetryShown(ctx: Context, insertionCategory: string, completion: Completion): void {
  completion.telemetry.markAsDisplayed();
  completion.telemetry.properties.reason = resultTypeToString(completion.resultType);
  telemetry(ctx, `${insertionCategory}.shown`, completion.telemetry);
}

function telemetryAccepted(ctx: Context, insertionCategory: string, telemetryData: TelemetryData): void {
  const telemetryName = `${insertionCategory}.accepted`;
  const cfManager = ctx.get(ContextualFilterManager);
  cfManager.previousLabel = 1;
  cfManager.previousLabelTimestamp = Date.now();
  telemetry(ctx, telemetryName, telemetryData);
}

function telemetryRejected(ctx: Context, insertionCategory: string, telemetryData: TelemetryData): void {
  const telemetryName = `${insertionCategory}.rejected`;
  const cfManager = ctx.get(ContextualFilterManager);
  cfManager.previousLabel = 0;
  cfManager.previousLabelTimestamp = Date.now();
  telemetry(ctx, telemetryName, telemetryData);
}

function mkCanceledResultTelemetry(
  telemetryBlob: TelemetryData,
  extraFlags: { cancelledNetworkRequest?: boolean } = {}
): { cancelledNetworkRequest?: boolean; telemetryBlob: TelemetryData } {
  return { ...extraFlags, telemetryBlob };
}

function mkBasicResultTelemetry(telemetryBlob: TelemetryWithExp): TelemetryProperties {
  const result: TelemetryProperties = {
    headerRequestId: telemetryBlob.properties.headerRequestId,
    copilot_trackingId: telemetryBlob.properties.copilot_trackingId,
  };

  if (telemetryBlob.properties.sku !== undefined) {
    result.sku = telemetryBlob.properties.sku;
  }
  if (telemetryBlob.properties.opportunityId !== undefined) {
    result.opportunityId = telemetryBlob.properties.opportunityId;
  }
  if (telemetryBlob.properties.organizations_list !== undefined) {
    result.organizations_list = telemetryBlob.properties.organizations_list;
  }
  if (telemetryBlob.properties.enterprise_list !== undefined) {
    result.enterprise_list = telemetryBlob.properties.enterprise_list;
  }

  result['abexp.assignmentcontext'] = telemetryBlob.filtersAndExp.exp.assignmentContext;
  return result;
}

function handleGhostTextResultTelemetry(
  ctx: Context,
  result: GhostTextResult
): [Result[], CompletionResultType] | void {
  if (result.type === 'success') {
    const timeToProduceMs = now() - result.telemetryBlob.issuedTime;
    const reason = resultTypeToString(result.resultType);
    const properties = { ...result.telemetryData, reason };
    const { foundOffset } = result.telemetryBlob.measurements;
    logger.debug(ctx, `ghostText produced from ${reason} in ${timeToProduceMs}ms with foundOffset ${foundOffset}`);
    telemetryRaw(ctx, 'ghostText.produced', properties, { timeToProduceMs, foundOffset });
    return result.value;
  }
  if (result.type !== 'promptOnly') {
    if (result.type === 'canceled') {
      telemetry(
        ctx,
        'ghostText.canceled',
        result.telemetryData.telemetryBlob.extendedBy({
          reason: result.reason,
          cancelledNetworkRequest: result.telemetryData.cancelledNetworkRequest ? 'true' : 'false',
        })
      );
      return;
    }
    telemetryRaw(ctx, `ghostText.${result.type}`, { ...result.telemetryData, reason: result.reason }, {});
  }
}

function resultTypeToString(
  resultType: CompletionResultType
): 'network' | 'cache' | 'cycling' | 'typingAsSuggested' | 'async' {
  switch (resultType) {
    case CompletionResultType.Network:
      return 'network';
    case CompletionResultType.Cache:
      return 'cache';
    case CompletionResultType.Cycling:
      return 'cycling';
    case CompletionResultType.TypingAsSuggested:
      return 'typingAsSuggested';
    case CompletionResultType.Async:
      return 'async';
  }
}

export {
  telemetryShown,
  telemetryAccepted,
  telemetryRejected,
  mkCanceledResultTelemetry,
  mkBasicResultTelemetry,
  handleGhostTextResultTelemetry,
  resultTypeToString,
};
