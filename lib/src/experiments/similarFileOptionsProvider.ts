import { getCppNumberOfSnippets, getCppSimilarFilesOptions } from './similarFileOptionsProviderCpp.ts';
import { LanguageId } from '../types.ts';
import { TelemetryWithExp } from '../telemetry.ts';
import { DEFAULT_NUM_SNIPPETS, defaultSimilarFilesOptions, SimilarFilesOptions } from '../../../prompt/src/lib.ts';

function getSimilarFilesOptions(exp: TelemetryWithExp, langId: LanguageId) {
  let optionsProvider = languageSimilarFilesOptions.get(langId);
  return optionsProvider ? optionsProvider(exp) : defaultSimilarFilesOptions;
}

function getNumberOfSnippets(exp: TelemetryWithExp, langId: LanguageId) {
  let provider = numberOfSnippets.get(langId);
  return provider ? provider(exp) : DEFAULT_NUM_SNIPPETS;
}

const languageSimilarFilesOptions = new Map<LanguageId, (exp: TelemetryWithExp) => SimilarFilesOptions>([
  ['cpp', getCppSimilarFilesOptions],
]);
const numberOfSnippets = new Map<LanguageId, (exp: TelemetryWithExp) => number>([['cpp', getCppNumberOfSnippets]]);

export { getNumberOfSnippets, getSimilarFilesOptions };
