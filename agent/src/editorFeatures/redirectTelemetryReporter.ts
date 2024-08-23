import { NotificationType } from 'vscode-languageserver/node';

import { Context } from '../../../lib/src/context';
import { TelemetryReporters } from '../../../lib/src/telemetry';
import { TelemetryMeasurements, TelemetryProperties } from '../../../lib/src/types';
import { Service } from '../service';
import { setupRedirectingTelemetryReporters as setupRedirectingTelemetryReportersModule } from './redirectTelemetryReporter';

export async function setupRedirectingTelemetryReporters(ctx: Context): Promise<void> {
  const container = ctx.get(TelemetryReporters);
  const deactivation = container.deactivate();
  container.setReporter(new RedirectTelemetryReporter(ctx));
  container.setRestrictedReporter(new RedirectTelemetryReporter(ctx, true));
  await deactivation;
}

export class RedirectTelemetryReporter {
  constructor(
    readonly ctx: Context,
    readonly codeSnippets = false
  ) { }

  get notificationName(): string {
    return this.codeSnippets ? 'codeSnippetTelemetry' : 'uedTelemetry';
  }

  sendTelemetryEvent(eventName: string, properties?: TelemetryProperties, measurements?: TelemetryMeasurements): void {
    this.ctx.get(Service).connection.sendNotification(new NotificationType(this.notificationName), {
      type: 'event',
      name: eventName,
      properties: properties || {},
      measurements: measurements || {},
    });
  }

  sendTelemetryErrorEvent(
    eventName: string,
    properties?: TelemetryProperties,
    measurements?: TelemetryMeasurements
  ): void {
    this.sendTelemetryEvent(eventName, properties, measurements);
  }

  async dispose(): Promise<void> { }
}
