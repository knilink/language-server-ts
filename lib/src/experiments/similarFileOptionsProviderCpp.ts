import { defaultCppSimilarFilesOptions } from '../../../prompt/src/snippetInclusion/similarFiles.ts';
// import './expConfig.ts';
import { TelemetryWithExp } from '../telemetry.ts';

function getCppSimilarFilesOptions(telemetryWithExp: TelemetryWithExp) {
  return {
    snippetLength: cppSnippetsWindowSizeForSimilarFiles(telemetryWithExp),
    threshold: cppSimilarFileThreshold(telemetryWithExp),
    maxTopSnippets: cppMaxTopSnippetsFromSimilarFiles(telemetryWithExp),
    maxCharPerFile: cppMaxSimilarFileSize(telemetryWithExp),
    maxNumberOfFiles: cppMaxSimilarFilesCount(telemetryWithExp),
    maxSnippetsPerFile: cppMaxSnippetsPerSimilarFile(telemetryWithExp),
  };
}
function getCppNumberOfSnippets(telemetryWithExp: TelemetryWithExp): number {
  return (
    telemetryWithExp.filtersAndExp.exp.variables.copilotnumberofsnippets ?? defaultCppSimilarFilesOptions.maxTopSnippets
  );
}
function cppSnippetsWindowSizeForSimilarFiles(telemetryWithExp: TelemetryWithExp): number {
  return (
    telemetryWithExp.filtersAndExp.exp.variables.copilotsnippetswindowsizeforsimilarfiles ??
    defaultCppSimilarFilesOptions.snippetLength
  );
}
function cppSimilarFileThreshold(telemetryWithExp: TelemetryWithExp): number {
  return (
    telemetryWithExp.filtersAndExp.exp.variables.copilotsimilarfilesnippetthreshold ??
    defaultCppSimilarFilesOptions.threshold
  );
}
function cppMaxSnippetsPerSimilarFile(telemetryWithExp: TelemetryWithExp): number {
  return (
    telemetryWithExp.filtersAndExp.exp.variables.maxsnippetspersimilarfile ??
    defaultCppSimilarFilesOptions.maxSnippetsPerFile
  );
}
function cppMaxTopSnippetsFromSimilarFiles(telemetryWithExp: TelemetryWithExp): number {
  return (
    telemetryWithExp.filtersAndExp.exp.variables.maxtopsnippetsfromsimilarfiles ??
    defaultCppSimilarFilesOptions.maxTopSnippets
  );
}
function cppMaxSimilarFileSize(telemetryWithExp: TelemetryWithExp): number {
  return (
    telemetryWithExp.filtersAndExp.exp.variables.maxsimilarfilesize ?? defaultCppSimilarFilesOptions.maxCharPerFile
  );
}
function cppMaxSimilarFilesCount(telemetryWithExp: TelemetryWithExp): number {
  return (
    telemetryWithExp.filtersAndExp.exp.variables.maxsimilarfilescount ?? defaultCppSimilarFilesOptions.maxNumberOfFiles
  );
}

export { getCppNumberOfSnippets, getCppSimilarFilesOptions };
