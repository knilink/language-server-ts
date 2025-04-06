import { Context } from '../context.ts';
import { Features } from './features.ts';
import { CopilotRelatedPluginVersionPrefix, Filter, FilterHeaders } from './filters.ts';
import { BuildInfo, ConfigKey, EditorAndPluginInfo, EditorSession, getBuildType, getConfig } from '../config.ts';
import { Logger } from '../logger.ts';
import { telemetryExpProblem } from '../telemetry.ts';

function setupExperimentationService(ctx: Context): void {
  const features = ctx.get(Features);

  features.registerStaticFilters(createAllFilters(ctx));
  features.registerDynamicFilter(
    'X-Copilot-OverrideEngine',
    () => getConfig(ctx, ConfigKey.DebugOverrideEngine) || getConfig(ctx, ConfigKey.DebugOverrideEngineLegacy)
  );
  features.registerDynamicFilter(
    'X-VSCode-ExtensionName',
    () => ctx.get(EditorAndPluginInfo).getEditorPluginInfo().name
  );
  features.registerDynamicFilter('X-VSCode-ExtensionVersion', () =>
    trimVersionSuffix(
      ctx.get(BuildInfo).isProduction() ? ctx.get(EditorAndPluginInfo).getEditorPluginInfo().version : '1.999.0'
    )
  );
  features.registerDynamicFilter('X-VSCode-ExtensionRelease', () => getPluginRelease(ctx));
  features.registerDynamicFilter('X-VSCode-Build', () => ctx.get(EditorAndPluginInfo).getEditorInfo().name);
  features.registerDynamicFilter('X-VSCode-AppVersion', () =>
    trimVersionSuffix(ctx.get(EditorAndPluginInfo).getEditorInfo().version)
  );
  features.registerDynamicFilter('X-VSCode-TargetPopulation', () => getTargetPopulation(ctx));
  features.registerDynamicFilterGroup(() => {
    const result: FilterHeaders = {};
    for (const plugin of ctx.get(EditorAndPluginInfo).getRelatedPluginInfo()) {
      const filterName = CopilotRelatedPluginVersionPrefix + plugin.name.replace(/[^A-Za-z]/g, '').toLowerCase();
      if (!Object.values(Filter).includes(filterName)) {
        telemetryExpProblem(ctx, {
          reason: `A filter could not be registered for the unrecognized related plugin "${plugin.name}".`,
        });
        continue;
      }
      result[filterName] = trimVersionSuffix(plugin.version);
    }
    return result;
  });
}

function getPluginRelease(ctx: Context): 'nightly' | 'stable' {
  let editorPluginInfo = ctx.get(EditorAndPluginInfo).getEditorPluginInfo();
  return (editorPluginInfo.name === 'copilot' && getBuildType(ctx) === 'nightly') ||
    (editorPluginInfo.name === 'copilot-intellij' && editorPluginInfo.version.endsWith('nightly'))
    ? 'nightly'
    : 'stable';
}

function getTargetPopulation(ctx: Context): 'insider' | 'public' {
  let editorPluginInfo = ctx.get(EditorAndPluginInfo).getEditorPluginInfo();
  return editorPluginInfo.name == 'copilot-intellij' && editorPluginInfo.version.endsWith('nightly')
    ? 'insider'
    : 'public';
}

function createAllFilters(ctx: Context): Record<string, string> {
  return createDefaultFilters(ctx);
}

function createDefaultFilters(ctx: Context): Record<string, string> {
  const editorSession = ctx.get(EditorSession);
  return { 'X-MSEdge-ClientId': editorSession.machineId };
}

function trimVersionSuffix(version: string): string {
  return version.split('-')[0];
}

const logger = new Logger('exp');

export { setupExperimentationService, createAllFilters, createDefaultFilters, trimVersionSuffix, logger };
