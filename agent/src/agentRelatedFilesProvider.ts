import { ProtocolRequestType } from 'vscode-languageserver-protocol';

import {
  RelatedFilesProvider,
  EmptyRelatedFilesResponse,
  type DocumentInfo,
  type Entry,
} from '../../lib/src/prompt/similarFiles/relatedFiles.ts';
// import { } from '../../lib/src/prompt/similarFiles/neighborFiles';

import { type Context } from '../../lib/src/context.ts';
import { Service } from './service.ts';
import { relatedFilesLogger } from '../../lib/src/prompt/similarFiles/relatedFiles.ts';
import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { Features } from '../../lib/src/experiments/features.ts';
import { ConfigKey, getConfig } from '../../lib/src/config.ts';
import { telemetry, TelemetryData, TelemetryWithExp } from '../../lib/src/telemetry.ts';

type RawResponse = { entries: Array<{ providerName: string; uris: string[] }>; traits: never };

class AgentRelatedFilesProvider extends RelatedFilesProvider {
  static getRelatedFilesRequestType = new ProtocolRequestType<
    { textDocument: { uri: DocumentInfo['uri'] } },
    RawResponse,
    unknown,
    unknown,
    unknown
  >('copilot/related');
  static telemetrySent = false;

  readonly reportedUnknownProviders = new Set<string>();

  constructor(context: Context) {
    super(context);
  }

  get service(): Service {
    return this.context.get(Service);
  }

  static mapProviderNameToNeighboringFileType(
    providerName: string
  ): 'related/csharp' | 'related/cpp' | 'related/cppsemanticcodecontext' | 'related/other' {
    const csharpProviderName = 'CSharpCopilotCompletionContextProvider';
    const cppProviderName = 'CppCopilotCompletionContextProvider';
    const cppSemanticCodeContextroviderName = 'CppCopilotCompletionSemanticCodeContextProvider';

    switch (providerName) {
      case csharpProviderName:
        return 'related/csharp';
      case cppProviderName:
        return 'related/cpp';
      case cppSemanticCodeContextroviderName:
        return 'related/cppsemanticcodecontext';
      default:
        return 'related/other';
    }
  }

  convert(rawResponse: RawResponse): { entries: Entry[] } {
    const response: { entries: Entry[]; traits: RawResponse['traits'] } = { entries: [], traits: rawResponse.traits };

    for (const rawEntry of rawResponse.entries) {
      const entry: Entry = {
        type: AgentRelatedFilesProvider.mapProviderNameToNeighboringFileType(rawEntry.providerName),
        uris: rawEntry.uris,
      };
      response.entries.push(entry);

      if (entry.type === 'related/other' && !this.reportedUnknownProviders.has(rawEntry.providerName)) {
        this.reportedUnknownProviders.add(rawEntry.providerName);
        relatedFilesLogger.warn(this.context, `unknown providerName ${rawEntry.providerName}`);
      }
    }
    return response;
  }

  async getRelatedFilesResponse(docInfo: DocumentInfo, telemetryData: TelemetryWithExp): Promise<{ entries: Entry[] }> {
    relatedFilesLogger.debug(this.context, `Fetching related files for ${docInfo.uri}`);

    const hasRelatedCapability = this.context.get(CopilotCapabilitiesProvider).getCapabilities().related ?? false;
    await AgentRelatedFilesProvider.relatedCapabilityTelemetry(this.context, telemetryData, hasRelatedCapability);

    if (!hasRelatedCapability) {
      relatedFilesLogger.debug(this.context, '`copilot/related` not supported');
      return EmptyRelatedFilesResponse;
    }

    if (
      !(
        this.context.get(Features).relatedFiles(telemetryData) ||
        getConfig(this.context, ConfigKey.DebugOverrideRelatedFiles)
      )
    ) {
      relatedFilesLogger.debug(this.context, '`copilot/related` experiment is not active');
      return EmptyRelatedFilesResponse;
    }

    try {
      const rawResponse = await this.service.connection.sendRequest(
        AgentRelatedFilesProvider.getRelatedFilesRequestType,
        { textDocument: { uri: docInfo.uri } }
      );
      return this.convert(rawResponse);
    } catch (e) {
      relatedFilesLogger.exception(this.context, e, '.copilotRelated');
    }

    return EmptyRelatedFilesResponse;
  }

  static async relatedCapabilityTelemetry(
    ctx: Context,
    telemetryData: TelemetryData,
    hasRelatedCapability: boolean
  ): Promise<void> {
    try {
      if (!hasRelatedCapability || AgentRelatedFilesProvider.telemetrySent) return;
      AgentRelatedFilesProvider.telemetrySent = true;
      await telemetry(ctx, 'copilotRelated.hasRelatedCapability', telemetryData);
    } catch (e) {
      relatedFilesLogger.exception(ctx, e, 'copilotRelated');
    }
  }
}

export { AgentRelatedFilesProvider };
