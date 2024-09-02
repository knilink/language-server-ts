import { TelemetryData } from '../telemetry.ts';
import { FilterHeaders } from '../types.ts';

const telmetryNames: Record<string, string> = {
  'X-Copilot-ClientTimeBucket': 'timeBucket',
  'X-Copilot-OverrideEngine': 'engine',
  'X-Copilot-Repository': 'repo',
  'X-Copilot-FileType': 'fileType',
  'X-Copilot-UserKind': 'userKind',
};

class FilterSettings {
  filters: Record<string, string>;

  constructor(filters: FilterHeaders) {
    this.filters = filters;
    for (let [filter, value] of Object.entries(this.filters)) {
      if (value === '') delete this.filters[filter];
    }
  }

  extends(otherFilterSettings: FilterSettings): boolean {
    for (let [filter, value] of Object.entries(otherFilterSettings.filters)) {
      if (this.filters[filter] !== value) return false;
    }
    return true;
  }

  addToTelemetry(telemetryData: TelemetryData) {
    for (let [filter, value] of Object.entries(this.filters)) {
      let telemetryName = telmetryNames[filter];
      if (telemetryName !== undefined) {
        telemetryData.properties[telemetryName] = value;
      }
    }
  }

  stringify(): string {
    let keys = Object.keys(this.filters);
    return keys
      .sort()
      .map((key: string) => `${key}:${this.filters[key]}`)
      .join(';');
  }

  toHeaders(): FilterHeaders {
    return { ...this.filters };
  }

  withChange(filter: string, value: string): FilterSettings {
    return new FilterSettings({ ...this.filters, [filter]: value });
  }
}

export { FilterSettings };
