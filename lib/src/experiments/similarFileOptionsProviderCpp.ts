import { useSubsetMatching } from './similarFileOptionsProvider.ts';
import { defaultCppSimilarFilesOptions } from '../../../prompt/src/snippetInclusion/similarFiles.ts';

import type { Context } from '../context.ts';
// import './expConfig.ts';
import type { TelemetryWithExp } from '../telemetry.ts';

function getCppSimilarFilesOptions(ctx: Context, telemetryWithExp: TelemetryWithExp) {
  return { ...defaultCppSimilarFilesOptions, useSubsetMatching: useSubsetMatching(ctx, telemetryWithExp) };
}
function getCppNumberOfSnippets(telemetryWithExp: TelemetryWithExp): number {
  return defaultCppSimilarFilesOptions.maxTopSnippets;
}

export { getCppNumberOfSnippets, getCppSimilarFilesOptions };
