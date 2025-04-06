import type { Context } from '../context.ts';
import type { TelemetryWithExp } from '../telemetry.ts';

import { Features } from '../experiments/features.ts';
import { logger } from '../logger.ts';

function fillInCppActiveExperiments(
  ctx: Context,
  activeExperiments: Map<string, unknown>, // MARK mutated
  telemetryData: TelemetryWithExp
) {
  try {
    const cppCodeSnippetsFeature = ctx.get(Features).cppCodeSnippetsFeatures(telemetryData);
    if (cppCodeSnippetsFeature) {
      activeExperiments.set(CppCodeSnippetsEnabledFeatures, cppCodeSnippetsFeature);
      const cppCodeSnippetsTimeBudgetFactor = ctx.get(Features).cppCodeSnippetsTimeBudgetFactor(telemetryData);

      if (cppCodeSnippetsTimeBudgetFactor) {
        activeExperiments.set(CppCodeSnippetsTimeBudgetFactor, cppCodeSnippetsTimeBudgetFactor);
      }

      const cppCodeSnippetsMaxDistanceToCaret = ctx.get(Features).cppCodeSnippetsMaxDistanceToCaret(telemetryData);

      if (cppCodeSnippetsMaxDistanceToCaret) {
        activeExperiments.set(CppCodeSnippetsMaxDistanceToCaret, cppCodeSnippetsMaxDistanceToCaret);
      }
    }
  } catch (e) {
    logger.debug(ctx, `Failed to get the active C++ Code Snippets experiments for the Context Provider API: ${e}`);
    return false;
  }
  return true;
}

const CppCodeSnippetsEnabledFeatures = 'CppCodeSnippetsEnabledFeatures';
const CppCodeSnippetsTimeBudgetFactor = 'CppCodeSnippetsTimeBudgetFactor';
const CppCodeSnippetsMaxDistanceToCaret = 'CppCodeSnippetsMaxDistanceToCaret';

export { fillInCppActiveExperiments };
