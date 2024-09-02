import { IReporter, TelemetryMeasurements, TelemetryProperties } from '../types.ts';

import { strictEqual } from 'assert';

type Event = {
  name: string;
  properties?: TelemetryProperties;
  measurements?: TelemetryMeasurements;
};

type ErrorEvent = Event & { errorProps?: Record<string, unknown> };

class TelemetrySpy implements IReporter {
  readonly events: Event[] = [];
  readonly errors: ErrorEvent[] = [];

  sendTelemetryEvent(eventName: string, properties?: TelemetryProperties, measurements?: TelemetryMeasurements) {
    this.events.push({ name: eventName, properties, measurements });
  }

  sendTelemetryErrorEvent(
    eventName: string,
    properties?: TelemetryProperties,
    measurements?: TelemetryMeasurements,
    errorProps?: Record<string, unknown>
  ) {
    this.errors.push({ name: eventName, properties, measurements, errorProps });
  }

  sendTelemetryException(error: Error, properties?: TelemetryProperties, measurements?: TelemetryMeasurements) {
    this.events.push({
      name: 'error.exception',
      properties: { message: error.message, ...properties },
      measurements,
    });
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }

  get hasEvent(): boolean {
    return this.events.length > 0;
  }

  get hasError(): boolean {
    return this.errors.length > 0;
  }

  get exceptions(): Event[] {
    return this.events.filter((e) => e.name === 'error.exception');
  }

  get hasException(): boolean {
    return this.exceptions.length > 0;
  }

  get firstEvent(): Event | undefined {
    return this.events[0];
  }

  get firstError(): ErrorEvent | undefined {
    return this.errors[0];
  }

  get firstException(): Event | undefined {
    return this.exceptions[0];
  }

  eventsMatching(filter: (event: Event) => boolean): Event[] {
    return this.events.filter(filter);
  }

  eventByName(name: string): Event {
    const candidates = this.events.filter((e) => e.name === name);
    strictEqual(candidates.length, 1, `Expected exactly one event with name ${name}`);
    return candidates[0];
  }

  errorsMatching(filter: (errorEvent: ErrorEvent) => boolean): ErrorEvent[] {
    return this.errors.filter(filter);
  }

  exceptionsMatching(filter: (event: Event) => boolean): Event[] {
    return this.exceptions.filter(filter);
  }

  assertHasProperty(assertion: (properties?: Record<string, unknown>) => boolean) {
    strictEqual(
      this.eventsMatching((e) => e.name !== 'ghostText.produced').every((e) => assertion(e.properties)),
      true
    );
  }
}

export { TelemetrySpy, Event, ErrorEvent };
