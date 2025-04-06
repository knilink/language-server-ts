import { getCppNumberOfSnippets, getCppSimilarFilesOptions } from './similarFileOptionsProviderCpp.ts';
import { ConfigKey, getConfig } from '../config.ts';
import { DEFAULT_NUM_SNIPPETS } from '../../../prompt/src/prompt.ts';
import { defaultSimilarFilesOptions } from '../../../prompt/src/snippetInclusion/similarFiles.ts';
import type {} from './expConfig.ts';
import type { SimilarFilesOptions } from '../../../prompt/src/lib.ts';

import type { LanguageId } from '../types.ts';
import type { TelemetryWithExp } from '../telemetry.ts';
import type { Context } from '../context.ts';

function getSimilarFilesOptions(ctx: Context, exp: TelemetryWithExp, langId: LanguageId) {
  const optionsProvider = languageSimilarFilesOptions.get(langId);
  return optionsProvider
    ? optionsProvider(ctx, exp)
    : { ...defaultSimilarFilesOptions, useSubsetMatching: useSubsetMatching(ctx, exp) };
}

function getNumberOfSnippets(exp: TelemetryWithExp, langId: LanguageId): number {
  let provider = numberOfSnippets.get(langId);
  return provider ? provider(exp) : DEFAULT_NUM_SNIPPETS;
}

function useSubsetMatching(ctx: Context, telemetryWithExp: TelemetryWithExp): boolean {
  return (
    (telemetryWithExp.filtersAndExp.exp.variables.copilotsubsetmatching ||
      getConfig(ctx, ConfigKey.UseSubsetMatching)) ??
    false
  );
}

const languageSimilarFilesOptions = new Map<LanguageId, (ctx: Context, exp: TelemetryWithExp) => SimilarFilesOptions>([
  ['cpp', getCppSimilarFilesOptions],
]);
const numberOfSnippets = new Map<LanguageId, (exp: TelemetryWithExp) => number>([['cpp', getCppNumberOfSnippets]]);

export { getNumberOfSnippets, getSimilarFilesOptions, useSubsetMatching };
