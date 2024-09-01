import { Context } from "../context.ts";
import {
  ghostTextDisplayLanguageParameters,
  ghostTextDisplayInterceptParameter,
  ghostTextDisplayQuantiles,
  ghostTextDisplayLog1pcompCharLenParameter,
  ghostTextDisplayMeanLogProbParameter,
  ghostTextDisplayMeanAlternativeLogProbParameter,
} from "./mlConstants.ts";
import { Logger, LogLevel } from "../logger.ts";
import { type TelemetryData } from "../telemetry.ts";

function linearInterpolation(x0: number, points: Map<number, number>): number {
  const x_after = Math.min(...Array.from(points.keys()).filter((x) => x >= x0));
  const x_before = Math.max(...Array.from(points.keys()).filter((x) => x < x0));
  const y_after = points.get(x_after);
  const y_before = points.get(x_before);

  if (y_after === undefined || y_before === undefined) {
    throw new Error('Invalid interpolation points');
  }

  return y_before + ((y_after - y_before) * (x0 - x_before)) / (x_after - x_before);
}

function ghostTextScoreConfidence(ctx: Context, telemetryData: TelemetryData): number {
  const values = { ...telemetryData.measurements };

  for (const lang in ghostTextDisplayLanguageParameters) {
    values[lang] = telemetryData.properties['customDimensions.languageId'] == lang ? 1 : 0;
  }

  return ghostTextRetentionModel.predict(ctx, values);
}

function ghostTextScoreQuantile(ctx: Context, telemetryData: TelemetryData): number {
  const values = { ...telemetryData.measurements };

  for (const lang in ghostTextDisplayLanguageParameters) {
    values[lang] = telemetryData.properties['customDimensions.languageId'] == lang ? 1 : 0;
  }

  return ghostTextRetentionModel.quantile(ctx, values);
}

const restraintLogger = new Logger(LogLevel.INFO, 'restraint');

const Logit = { link: (x: number) => Math.exp(x) / (1 + Math.exp(x)), unlink: (p: number) => Math.log(p / (1 - p)) };

class Regressor {
  constructor(
    readonly name: string,
    readonly coefficient: number,
    readonly transformation: (value: number) => number = (x) => x
  ) { }

  contribution(value: number): number {
    return this.coefficient * this.transformation(value);
  }
}

class LogisticRegression {
  logitsToQuantiles: Map<number, number>;
  link: typeof Logit;

  constructor(
    readonly intercept: number,
    readonly coefficients: Regressor[],
    quantiles?: Record<string, number>
  ) {
    this.link = Logit;
    this.logitsToQuantiles = new Map();
    this.logitsToQuantiles.set(0, 0);
    this.logitsToQuantiles.set(1, 1);

    if (quantiles) {
      for (const key in quantiles) {
        this.logitsToQuantiles.set(quantiles[key], Number(key));
      }
    }
  }

  predict(ctx: Context, values: Record<string, number>): number {
    let sum = this.intercept;
    for (const regressor of this.coefficients) {
      const value = values[regressor.name];
      if (value === undefined) return NaN;
      sum += regressor.contribution(value);
    }
    return this.link.link(sum);
  }

  quantile(ctx: Context, values: Record<string, number>): number {
    const logit = this.predict(ctx, values);
    if (isNaN(logit)) return NaN;
    return linearInterpolation(logit, this.logitsToQuantiles);
  }
}

const ghostTextRetentionModel = new LogisticRegression(
  ghostTextDisplayInterceptParameter,
  [
    new Regressor('compCharLen', ghostTextDisplayLog1pcompCharLenParameter, (x) => Math.log(1 + x)),
    new Regressor('meanLogProb', ghostTextDisplayMeanLogProbParameter),
    new Regressor('meanAlternativeLogProb', ghostTextDisplayMeanAlternativeLogProbParameter),
  ].concat(Object.entries(ghostTextDisplayLanguageParameters).map(([key, value]) => new Regressor(key, value))),
  ghostTextDisplayQuantiles
);

export { ghostTextScoreConfidence, ghostTextScoreQuantile, restraintLogger, ghostTextRetentionModel };
