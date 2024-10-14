import { defaultCppSimilarFilesOptions } from '../../../prompt/src/snippetInclusion/similarFiles.ts';
// import './expConfig.ts';
import { TelemetryWithExp } from '../telemetry.ts';

function getCppSimilarFilesOptions(telemetryWithExp: TelemetryWithExp) {
  return {
    snippetLength: defaultCppSimilarFilesOptions.snippetLength,
    threshold: defaultCppSimilarFilesOptions.threshold,
    maxTopSnippets: defaultCppSimilarFilesOptions.maxTopSnippets,
    maxCharPerFile: cppMaxSimilarFileSize(telemetryWithExp),
    maxNumberOfFiles: defaultCppSimilarFilesOptions.maxNumberOfFiles,
    maxSnippetsPerFile: defaultCppSimilarFilesOptions.maxSnippetsPerFile,
  };
}
function getCppNumberOfSnippets(telemetryWithExp: TelemetryWithExp): number {
  return defaultCppSimilarFilesOptions.maxTopSnippets;
}

function cppMaxSimilarFileSize(telemetryWithExp: TelemetryWithExp): number {
  return (
    telemetryWithExp.filtersAndExp.exp.variables.copilotmaxsimilarfilesize ??
    defaultCppSimilarFilesOptions.maxCharPerFile
  );
}

export { getCppNumberOfSnippets, getCppSimilarFilesOptions };
