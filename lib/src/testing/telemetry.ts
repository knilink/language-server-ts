import { IReporter, TelemetryProperties, TelemetryMeasurements } from "../types.ts";
// import { } from '../telemetry/setupTelemetryReporters';
// import { } from '../networkConfiguration';
// import { } from './telemetrySpy';
// import { } from '../telemetry';
import { PromiseQueue } from "../util/promiseQueue.ts";

class TestPromiseQueue extends PromiseQueue {
  async awaitPromises(): Promise<void> {
    await Promise.all(this.promises);
  }
}

class FailingTelemetryReporter implements IReporter {
  sendTelemetryEvent(eventName: string, properties?: TelemetryProperties, measurements?: TelemetryMeasurements): void {
    throw new Error('Telemetry disabled');
  }

  sendTelemetryErrorEvent(
    eventName: string,
    properties?: TelemetryProperties,
    measurements?: TelemetryMeasurements,
    errorProps?: any
  ): void {
    throw new Error('Telemetry disabled');
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }

  hackOptOutListener(): void { }
}

export { FailingTelemetryReporter };

export { TestPromiseQueue };
