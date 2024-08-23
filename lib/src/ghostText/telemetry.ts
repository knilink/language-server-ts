import { Context } from '../context';
import { telemetry, TelemetryData, telemetryRaw } from '../telemetry';
import { type TelemetryProperties, CompletionResultType } from '../types';
import { ContextualFilterManager } from './contextualFilter';
import { GhostTextResult, Result } from './ghostText';

function telemetryShown(
  ctx: Context,
  insertionCategory: string,
  telemetryData: TelemetryData,
  fromCache: boolean
): void {
  telemetryData.markAsDisplayed();
  const eventName = fromCache ? `${insertionCategory}.shownFromCache` : `${insertionCategory}.shown`;
  telemetry(ctx, eventName, telemetryData);
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

function mkBasicResultTelemetry(telemetryBlob: TelemetryData): TelemetryProperties {
  const result: TelemetryProperties = {
    headerRequestId: telemetryBlob.properties.headerRequestId,
    copilot_trackingId: telemetryBlob.properties.copilot_trackingId,
  };

  if (telemetryBlob.properties.sku !== undefined) {
    result.sku = telemetryBlob.properties.sku;
  }
  if (telemetryBlob.properties.organizations_list !== undefined) {
    result.organizations_list = telemetryBlob.properties.organizations_list;
  }
  if (telemetryBlob.properties.enterprise_list !== undefined) {
    result.enterprise_list = telemetryBlob.properties.enterprise_list;
  }

  return result;
}

async function handleGhostTextResultTelemetry(
  ctx: Context,
  result: GhostTextResult
): Promise<[Result[], CompletionResultType] | void> {
  if (result.type === 'success') {
    telemetryRaw(ctx, 'ghostText.produced', result.telemetryData, {});
    return result.value;
  }
  if (result.type !== 'abortedBeforeIssued') {
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

export {
  telemetryShown,
  telemetryAccepted,
  telemetryRejected,
  mkCanceledResultTelemetry,
  mkBasicResultTelemetry,
  handleGhostTextResultTelemetry,
};
