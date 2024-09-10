import { Context } from '../context.ts';
import { AppInsightsReporter } from './appInsightsReporter.ts';
import { TelemetryReporters } from '../telemetry.ts';

function setupTelemetryReporters(ctx: Context, telemetryNamespace: string, telemetryEnabled: boolean): Promise<void> {
  return ctx.get(TelemetryInitialization).initialize(ctx, telemetryNamespace, telemetryEnabled);
}

const APP_INSIGHTS_KEY = '7d7048df-6dd0-4048-bb23-b716c1461f8f';
const APP_INSIGHTS_KEY_SECURE = '3fdd7f28-937a-48c8-9a21-ba337db23bd1';
const APP_INSIGHTS_KEY_FT = 'f0000000-0000-0000-0000-000000000000';

class TelemetryInitialization {
  private _args?: {
    namespace: string;
    enabled: boolean;
  };

  get isInitialized(): boolean {
    return !!this._args;
  }

  async initialize(ctx: Context, telemetryNamespace: string, telemetryEnabled: boolean): Promise<void> {
    const deactivation = ctx.get(TelemetryReporters).deactivate();
    this._args = {
      namespace: telemetryNamespace,
      enabled: telemetryEnabled,
    };
    if (telemetryEnabled) {
      const container = ctx.get(TelemetryReporters);
      container.setReporter(new AppInsightsReporter(ctx, telemetryNamespace, APP_INSIGHTS_KEY));
      container.setRestrictedReporter(new AppInsightsReporter(ctx, telemetryNamespace, APP_INSIGHTS_KEY_SECURE));
      container.setFTReporter(new AppInsightsReporter(ctx, telemetryNamespace, APP_INSIGHTS_KEY_FT, true));
    }
    await deactivation;
  }

  async reInitialize(ctx: Context): Promise<void> {
    if (this._args) {
      await this.initialize(ctx, this._args.namespace, this._args.enabled);
    } else {
      throw new Error('Cannot re-initialize telemetry that has not been initialized.');
    }
  }
}

export { setupTelemetryReporters, TelemetryInitialization };
