interface IGranularity {
  getCurrentAndUpComingValues(now: Date): [string, string[]];
  getValue(now: Date): string;
  getUpcomingValues(now: Date): string[];
}

abstract class GranularityImplementation implements IGranularity {
  prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  getCurrentAndUpComingValues(now: Date): [string, string[]] {
    const currentValue = this.getValue(now);
    const upcomingValues = this.getUpcomingValues(now);
    return [currentValue, upcomingValues];
  }

  abstract getValue(now: Date): string;
  abstract getUpcomingValues(now: Date): string[];
}

class ConstantGranularity extends GranularityImplementation {
  getValue(now: Date): string {
    return this.prefix;
  }

  getUpcomingValues(now: Date): string[] {
    return [];
  }
}

const DEFAULT_GRANULARITY = (prefix: string) => new ConstantGranularity(prefix);

class TimeBucketGranularity extends GranularityImplementation {
  fetchBeforeFactor: number;
  anchor: number;
  timePeriodLengthMs?: number;
  numByCallBuckets?: number;

  constructor(prefix: string, fetchBeforeFactor = 0.5, anchor = new Date().setUTCHours(0, 0, 0, 0)) {
    super(prefix);
    this.prefix = prefix;
    this.fetchBeforeFactor = fetchBeforeFactor;
    this.anchor = anchor;
  }

  setTimePeriod(lengthMs: number): void {
    if (isNaN(lengthMs)) {
      this.timePeriodLengthMs = undefined;
    } else {
      this.timePeriodLengthMs = lengthMs;
    }
  }

  setByCallBuckets(numBuckets: number): void {
    if (isNaN(numBuckets)) {
      this.numByCallBuckets = undefined;
    } else {
      this.numByCallBuckets = numBuckets;
    }
  }

  getValue(now: Date): string {
    return `${this.prefix}${this.getTimePeriodBucketString(now)}${this.numByCallBuckets ? this.timeHash(now) : ''}`;
  }

  private getTimePeriodBucketString(now: Date): string {
    if (this.timePeriodLengthMs === undefined) return '';
    return Math.floor((now.getTime() - this.anchor) / this.timePeriodLengthMs).toString();
  }

  getUpcomingValues(now: Date): string[] {
    const upcomingValues = [];
    const upcomingTimePeriodBucketStrings = this.getUpcomingTimePeriodBucketStrings(now);
    const upcomingByCallBucketStrings = this.getUpcomingByCallBucketStrings();
    for (let upcomingTimePeriodBucketString of upcomingTimePeriodBucketStrings)
      for (let upcomingByCallBucketString of upcomingByCallBucketStrings)
        upcomingValues.push(this.prefix + upcomingTimePeriodBucketString + upcomingByCallBucketString);
    return upcomingValues;
  }

  getUpcomingTimePeriodBucketStrings(now: Date) {
    if (this.timePeriodLengthMs === undefined) return [''];
    if ((now.getTime() - this.anchor) % this.timePeriodLengthMs < this.fetchBeforeFactor * this.timePeriodLengthMs)
      return [this.getTimePeriodBucketString(now)];
    let inABit = new Date(now.getTime() + this.timePeriodLengthMs);
    return [this.getTimePeriodBucketString(now), this.getTimePeriodBucketString(inABit)];
  }

  _getUpcomingValues(now: Date): string[] {
    const currentBucket = this.getTimePeriodBucketString(now);
    if (this.timePeriodLengthMs === undefined || !currentBucket) return [currentBucket];

    const nextBit = new Date(now.getTime() + this.timePeriodLengthMs);
    const upcomingBuckets = [currentBucket, this.getTimePeriodBucketString(nextBit)];

    return upcomingBuckets;
  }

  private getUpcomingByCallBucketStrings(): string[] {
    if (this.numByCallBuckets === undefined) return [''];
    return Array.from({ length: this.numByCallBuckets }, (_, i) => i.toString());
  }

  private timeHash(time: Date): number {
    if (this.numByCallBuckets == null) return 0;
    return (7883 * (time.getTime() % this.numByCallBuckets)) % this.numByCallBuckets;
  }

  dateToTimePartString(date: Date): string {
    return this.timePeriodLengthMs == null
      ? ''
      : Math.floor((date.getTime() - this.anchor) / this.timePeriodLengthMs).toString();
  }
}

export { GranularityImplementation, TimeBucketGranularity, DEFAULT_GRANULARITY };
