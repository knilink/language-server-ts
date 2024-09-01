import { Context } from "../context.ts";
import { TelemetryData } from "../telemetry.ts";

import {
  contextualFilterIntercept,
  contextualFilterWeights,
  contextualFilterLanguageMap,
  contextualFilterCharacterMap,
} from "./contextualFilterConstants.ts";
import { treeScore } from "./contextualFilterTree.js";

function getLastLineLength(source: string): number {
  const lines = source.split('\n');
  return lines[lines.length - 1].length;
}

class ContextualFilterManager {
  previousLabel: number = 0; // might be enum
  previousLabelTimestamp: number = Date.now() - 3600;
  probabilityAccept: number = 0;
}

interface IPrompt {
  prefix: string;
}

function contextualFilterScore(
  ctx: Context,
  telemetryData: TelemetryData,
  prompt: IPrompt,
  contextualFilterEnableTree: boolean
) {
  const cfManager = ctx.get(ContextualFilterManager);
  const yt = cfManager.previousLabel;
  const acw =
    'afterCursorWhitespace' in telemetryData.properties && telemetryData.properties.afterCursorWhitespace === 'true'
      ? 1
      : 0;

  const dt = (Date.now() - cfManager.previousLabelTimestamp) / 1e3;
  const ln_dt = Math.log(1 + dt);
  let ln_promptLastLineLength = 0;
  let promptLastCharIndex = 0;
  const promptPrefix = prompt.prefix;
  if (promptPrefix) {
    ln_promptLastLineLength = Math.log(1 + getLastLineLength(promptPrefix));
    let promptLastChar = promptPrefix.slice(-1);
    contextualFilterCharacterMap[promptLastChar] !== void 0 &&
      (promptLastCharIndex = contextualFilterCharacterMap[promptLastChar]);
  }
  let ln_promptLastLineRstripLength = 0,
    promptLastRstripCharIndex = 0,
    promptPrefixRstrip = promptPrefix.trimEnd();
  if (promptPrefixRstrip) {
    ln_promptLastLineRstripLength = Math.log(1 + getLastLineLength(promptPrefixRstrip));
    let promptLastRstripChar = promptPrefixRstrip.slice(-1);
    contextualFilterCharacterMap[promptLastRstripChar] !== void 0 &&
      (promptLastRstripCharIndex = contextualFilterCharacterMap[promptLastRstripChar]);
  }
  let ln_documentLength = 0;
  if ('documentLength' in telemetryData.measurements) {
    const documentLength = telemetryData.measurements.documentLength;
    ln_documentLength = Math.log(1 + documentLength);
  }
  let ln_promptEndPos = 0;
  if ('promptEndPos' in telemetryData.measurements) {
    const promptEndPos = telemetryData.measurements.promptEndPos;
    ln_promptEndPos = Math.log(1 + promptEndPos);
  }
  let relativeEndPos = 0;
  if ('promptEndPos' in telemetryData.measurements && 'documentLength' in telemetryData.measurements) {
    let documentLength = telemetryData.measurements.documentLength;
    relativeEndPos = (telemetryData.measurements.promptEndPos + 0.5) / (1 + documentLength);
  }
  let languageIndex = 0;
  contextualFilterLanguageMap[telemetryData.properties.languageId] !== void 0 &&
    (languageIndex = contextualFilterLanguageMap[telemetryData.properties.languageId]);
  let probabilityAccept = 0;
  if (contextualFilterEnableTree) {
    let features = new Array(221).fill(0);
    features[0] = yt;
    features[1] = acw;
    features[2] = ln_dt;
    features[3] = ln_promptLastLineLength;
    features[4] = ln_promptLastLineRstripLength;
    features[5] = ln_documentLength;
    features[6] = ln_promptEndPos;
    features[7] = relativeEndPos;
    features[8 + languageIndex] = 1;
    features[29 + promptLastCharIndex] = 1;
    features[125 + promptLastRstripCharIndex] = 1;
    probabilityAccept = treeScore(features)[1];
  } else {
    let sum = contextualFilterIntercept;
    sum += contextualFilterWeights[0] * yt;
    sum += contextualFilterWeights[1] * acw;
    sum += contextualFilterWeights[2] * ln_dt;
    sum += contextualFilterWeights[3] * ln_promptLastLineLength;
    sum += contextualFilterWeights[4] * ln_promptLastLineRstripLength;
    sum += contextualFilterWeights[5] * ln_documentLength;
    sum += contextualFilterWeights[6] * ln_promptEndPos;
    sum += contextualFilterWeights[7] * relativeEndPos;
    sum += contextualFilterWeights[8 + languageIndex];
    sum += contextualFilterWeights[29 + promptLastCharIndex];
    sum += contextualFilterWeights[125 + promptLastRstripCharIndex];
    probabilityAccept = 1 / (1 + Math.exp(-sum));
  }

  ctx.get(ContextualFilterManager).probabilityAccept = probabilityAccept;
  return probabilityAccept;
}

export { contextualFilterScore, ContextualFilterManager };
