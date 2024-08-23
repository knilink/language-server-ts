import { Clock } from '../clock';
import { FilterSettings } from './filters';
import { TimeBucketGranularity, GranularityImplementation, DEFAULT_GRANULARITY } from './granularityImplementation';

const BUCKETFILTER: string = 'X-Copilot-ClientTimeBucket';

class GranularityDirectory {
  specs: Map<FilterSettings, TimeBucketGranularity>;
  prefix: string;
  clock: Clock;
  defaultGranularity: GranularityImplementation;

  constructor(prefix: string, clock: Clock) {
    this.specs = new Map();
    this.prefix = prefix;
    this.clock = clock;
    this.defaultGranularity = DEFAULT_GRANULARITY(prefix);
  }

  selectGranularity(filters: FilterSettings): GranularityImplementation {
    for (let [rememberedFilters, granularity] of this.specs) {
      if (filters.extends(rememberedFilters)) return granularity;
    }
    return this.defaultGranularity;
  }

  update(filters: FilterSettings, byCallBuckets?: number, timePeriodSizeInH?: number): void {
    const validByCallBuckets = typeof byCallBuckets === 'number' && byCallBuckets > 1 ? byCallBuckets : NaN;
    const validTimePeriodSizeInH =
      typeof timePeriodSizeInH === 'number' && timePeriodSizeInH > 0 ? timePeriodSizeInH : NaN;

    if (isNaN(validByCallBuckets) && isNaN(validTimePeriodSizeInH)) {
      this.specs.delete(filters);
    } else {
      const newGranularity = new TimeBucketGranularity(this.prefix);
      !isNaN(validByCallBuckets) && newGranularity.setByCallBuckets(validByCallBuckets);
      !isNaN(validTimePeriodSizeInH) && newGranularity.setTimePeriod(validTimePeriodSizeInH * 3600 * 1e3);
      this.specs.set(filters, newGranularity);
    }
  }

  extendFilters(filters: FilterSettings): {
    newFilterSettings: FilterSettings;
    otherFilterSettingsToPrefetch: FilterSettings[];
  } {
    const implementation = this.selectGranularity(filters);
    const [value, upcomingValues] = implementation.getCurrentAndUpComingValues(this.clock.now());

    return {
      newFilterSettings: filters.withChange(BUCKETFILTER, value),
      otherFilterSettingsToPrefetch: upcomingValues.map((v) => filters.withChange(BUCKETFILTER, v)),
    };
  }
}

export { GranularityDirectory };
