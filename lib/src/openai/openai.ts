import type { OpenAIRequestId, Choice, Unknown } from '../types.ts';
import type { LanguageId } from '../../../prompt/src/types.ts';
import type { Context } from '../context.ts';

import { logger } from '../logger.ts';
import { logEngineCompletion, type TelemetryWithExp } from '../telemetry.ts';
import { isRunningInTest } from '../testing/runtimeMode.ts';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_MAX_COMPLETION_LENGTH } from '../../../prompt/src/prompt.ts';
import type {} from './fetch.ts';
import type {} from '../../../prompt/src/lib.ts';

type APIChoice = {
  completionText: string;
  meanLogProb?: number;
  meanAlternativeLogProb?: number;
  choiceIndex: number;
  requestId: OpenAIRequestId;
  modelInfo?: never; // unknown
  blockFinished: boolean;
  // string ../suggestions/suggestions.ts
  tokens: string[];
  numTokens: number;
  // TelemetryWithExp ../../../agent/src/methods/getCompletions.ts
  telemetryData: TelemetryWithExp;
  // optional ../ghostText/progressiveReveal.ts
  // Record<...> Object.entries(this.choice.copilotAnnotations) at ../ghostText/progressiveReveal.ts
  copilotAnnotations?: { ip_code_citations?: Unknown.Annotation[] };
  clientCompletionId: string;
};

function convertToAPIChoice(
  ctx: Context,
  completionText: string,
  jsonData: any,
  // ./stream.ts
  choiceIndex: number,
  requestId: OpenAIRequestId,
  blockFinished: boolean,
  telemetryData: TelemetryWithExp
): APIChoice {
  logEngineCompletion(ctx, completionText, jsonData, requestId, choiceIndex);
  return {
    completionText: completionText,
    meanLogProb: calculateMeanLogProb(ctx, jsonData),
    meanAlternativeLogProb: calculateMeanAlternativeLogProb(ctx, jsonData),
    choiceIndex: choiceIndex,
    requestId: requestId,
    blockFinished: blockFinished,
    tokens: jsonData.tokens,
    numTokens: jsonData.tokens.length,
    telemetryData: telemetryData,
    copilotAnnotations: jsonData.copilot_annotations,
    clientCompletionId: uuidv4(),
  };
}

async function* cleanupIndentChoices(
  choices: AsyncIterable<APIChoice>,
  indentation: string
): AsyncGenerator<APIChoice> {
  for await (const choice of choices) {
    const choiceCopy = { ...choice };
    const completionLines = choiceCopy.completionText.split('\n');
    for (let i = 0; i < completionLines.length; ++i) {
      let newLine = completionLines[i].trimStart();
      if (newLine === '') {
        completionLines[i] = newLine;
      } else {
        completionLines[i] = indentation + newLine;
      }
    }
    choiceCopy.completionText = completionLines.join('\n');
    yield choiceCopy;
  }
}

function calculateMeanLogProb(ctx: Context, jsonData: any): number | undefined {
  const { token_logprobs } = jsonData?.logprobs ?? {};
  if (token_logprobs) {
    try {
      let logProbSum = 0;
      let numTokens = 0;
      let iterLimit = 50;
      for (let i = 0; i < token_logprobs.length - 1 && iterLimit > 0; i++, --iterLimit) {
        logProbSum += token_logprobs[i];
        numTokens++;
      }
      return numTokens > 0 ? logProbSum / numTokens : undefined;
    } catch (e) {
      logger.exception(ctx, e, 'Error calculating mean prob');
    }
  }
}

function calculateMeanAlternativeLogProb(ctx: Context, jsonData: any): number | undefined {
  const { top_logprobs, tokens } = jsonData?.logprobs ?? {};
  if (top_logprobs && tokens) {
    try {
      let logProbSum = 0;
      let numTokens = 0;
      let iterLimit = 50;
      for (let i = 0; i < top_logprobs.length - 1 && iterLimit > 0; i++, --iterLimit) {
        const options = { ...top_logprobs[i] };
        delete options[tokens[i]];
        logProbSum += Math.max(...(Object.values(options) as any)); // MARK
        numTokens++;
      }
      return numTokens > 0 ? logProbSum / numTokens : undefined;
    } catch (e) {
      logger.exception(ctx, e, 'Error calculating mean prob');
    }
  }
}

const stopsForLanguage: { [key in LanguageId]: string[] } = {
  markdown: ['\n\n\n'],
  python: ['\ndef ', '\nclass ', '\nif ', '\n#'],
};

function getTemperatureForSamples(ctx: Context, numShots: number): number {
  return isRunningInTest(ctx) || numShots <= 1 ? 0 : numShots < 10 ? 0.2 : numShots < 20 ? 0.4 : 0.8;
}

function getStops(ctx: Context, languageId?: LanguageId): string[] {
  return languageId && stopsForLanguage[languageId] ? stopsForLanguage[languageId] : ['\n\n\n', '\n```'];
}

function getTopP(ctx: Context): number {
  return 1;
}

function getMaxSolutionTokens(ctx: Context): number {
  return DEFAULT_MAX_COMPLETION_LENGTH;
}

export {
  getMaxSolutionTokens,
  getTopP,
  getStops,
  getTemperatureForSamples,
  cleanupIndentChoices,
  convertToAPIChoice,
  APIChoice,
};
