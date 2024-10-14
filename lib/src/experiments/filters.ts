import { TelemetryData } from '../telemetry.ts';

const CopilotRelatedPluginVersionPrefix = 'X-Copilot-RelatedPluginVersion-';

const Filter = {
  Market: 'X-MSEdge-Market',
  CorpNet: 'X-FD-Corpnet',
  ApplicationVersion: 'X-VSCode-AppVersion',
  Build: 'X-VSCode-Build',
  ClientId: 'X-MSEdge-ClientId',
  ExtensionName: 'X-VSCode-ExtensionName',
  ExtensionVersion: 'X-VSCode-ExtensionVersion',
  Language: 'X-VSCode-Language',
  TargetPopulation: 'X-VSCode-TargetPopulation',
  CopilotClientTimeBucket: 'X-Copilot-ClientTimeBucket',
  CopilotOverrideEngine: 'X-Copilot-OverrideEngine',
  CopilotRepository: 'X-Copilot-Repository',
  CopilotFileType: 'X-Copilot-FileType',
  CopilotUserKind: 'X-Copilot-UserKind',
  CopilotDogfood: 'X-Copilot-Dogfood',
  CopilotCustomModel: 'X-Copilot-CustomModel',
  CopilotRelatedPluginVersionCppTools: CopilotRelatedPluginVersionPrefix + 'msvscodecpptools',
  CopilotRelatedPluginVersionCMakeTools: CopilotRelatedPluginVersionPrefix + 'msvscodecmaketools',
  CopilotRelatedPluginVersionMakefileTools: CopilotRelatedPluginVersionPrefix + 'msvscodemakefiletools',
  CopilotRelatedPluginVersionCSharpDevKit: CopilotRelatedPluginVersionPrefix + 'msdotnettoolscsdevkit',
  CopilotRelatedPluginVersionPython: CopilotRelatedPluginVersionPrefix + 'mspythonpython',
  CopilotRelatedPluginVersionPylance: CopilotRelatedPluginVersionPrefix + 'mspythonvscodepylance',
  CopilotRelatedPluginVersionJavaPack: CopilotRelatedPluginVersionPrefix + 'vscjavavscodejavapack',
  CopilotRelatedPluginVersionTypescript: CopilotRelatedPluginVersionPrefix + 'vscodetypescriptlanguagefeatures',
  CopilotRelatedPluginVersionTypescriptNext: CopilotRelatedPluginVersionPrefix + 'msvscodevscodetypescriptnext',
  CopilotRelatedPluginVersionCSharp: CopilotRelatedPluginVersionPrefix + 'msdotnettoolscsharp',
};

type FilterHeaderNames = (typeof Filter)[keyof typeof Filter];

type FilterHeaders = Record<FilterHeaderNames, string>;

const telmetryNames: Record<string, string> = {
  'X-Copilot-ClientTimeBucket': 'timeBucket',
  'X-Copilot-OverrideEngine': 'engine',
  'X-Copilot-Repository': 'repo',
  'X-Copilot-FileType': 'fileType',
  'X-Copilot-UserKind': 'userKind',
};

class FilterSettings {
  filters: FilterHeaders;

  constructor(filters: FilterHeaders) {
    this.filters = filters;
    for (let [filter, value] of Object.entries(this.filters)) {
      if (value === '') delete this.filters[filter];
    }
  }

  extends(otherFilterSettings: FilterSettings): boolean {
    for (let [filter, value] of Object.entries(otherFilterSettings.filters)) {
      if (this.filters[filter] !== value) return false;
    }
    return true;
  }

  addToTelemetry(telemetryData: TelemetryData) {
    for (let [filter, value] of Object.entries(this.filters)) {
      let telemetryName = telmetryNames[filter];
      if (telemetryName !== undefined && value !== undefined) {
        telemetryData.properties[telemetryName] = value;
      }
    }
  }

  stringify(): string {
    let keys = Object.keys(this.filters);
    return keys
      .sort()
      .map((key: string) => `${key}:${this.filters[key]}`)
      .join(';');
  }

  toHeaders(): FilterHeaders {
    return { ...this.filters };
  }

  withChange(filter: string, value: string): FilterSettings {
    return new FilterSettings({ ...this.filters, [filter]: value });
  }
}

export { CopilotRelatedPluginVersionPrefix, Filter, FilterSettings, FilterHeaderNames, FilterHeaders };
