import type { Context } from '../../lib/src/context.ts';
import type { TelemetryData, TelemetryWithExp } from '../../lib/src/telemetry.ts';
import type { RawResponse, Trait, Entry } from '../../types/src/index.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { DocumentUri } from 'vscode-languageserver-types';

import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { Service } from './service.ts';
import {
  EmptyRelatedFilesResponse,
  RelatedFilesProvider,
  relatedFilesLogger,
} from '../../lib/src/prompt/similarFiles/relatedFiles.ts';
import { telemetry } from '../../lib/src/telemetry.ts';
import { CopilotRelatedRequest } from '../../types/src/related.ts';
import type {} from '../../lib/src/prompt/similarFiles/neighborFiles.ts';
import type {} from '../../types/src/index.ts';

class AgentRelatedFilesProvider extends RelatedFilesProvider {
  static telemetrySent = false;

  readonly reportedUnknownProviders = new Set<string>();

  constructor(context: Context) {
    super(context);
  }

  get service(): Service {
    return this.context.get(Service);
  }

  static mapProviderNameToNeighboringFileType(providerName: string): Entry['type'] {
    const csharpProviderName = 'CSharpCopilotCompletionContextProvider';
    const csharpRoslynProviderName = 'CSharpRoslynCompletionRelatedContextProvider';
    const cppProviderName = 'CppCopilotCompletionContextProvider';
    const cppSemanticCodeContextroviderName = 'CppCopilotCompletionSemanticCodeContextProvider';

    switch (providerName) {
      case csharpProviderName:
        return 'related/csharp';
      case csharpRoslynProviderName:
        return 'related/csharproslyn';
      case cppProviderName:
        return 'related/cpp';
      case cppSemanticCodeContextroviderName:
        return 'related/cppsemanticcodecontext';
      default:
        return 'related/other';
    }
  }

  convert(rawResponse: RawResponse): RelatedFilesProvider.RelatedFilesResponse {
    const response: { entries: Entry[]; traits: Trait[] } = {
      entries: [],
      traits: rawResponse.traits,
    };

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

  async getRelatedFilesResponse(
    docInfo: { uri: DocumentUri; data: unknown },
    telemetryData: TelemetryWithExp,
    cancellationToken: CancellationToken
  ): Promise<RelatedFilesProvider.RelatedFilesResponse | null> {
    relatedFilesLogger.debug(this.context, `Fetching related files for ${docInfo.uri}`);

    const hasRelatedCapability = this.context.get(CopilotCapabilitiesProvider).getCapabilities().related ?? false;
    await AgentRelatedFilesProvider.relatedCapabilityTelemetry(this.context, telemetryData, hasRelatedCapability);

    if (!hasRelatedCapability) {
      relatedFilesLogger.debug(this.context, '`copilot/related` not supported');
      return EmptyRelatedFilesResponse;
    }

    try {
      const rawResponse = await this.service.connection.sendRequest(
        CopilotRelatedRequest.type,
        {
          textDocument: { uri: docInfo.uri },
          data: docInfo.data,
          telemetry: { properties: telemetryData.properties, measurements: telemetryData.measurements },
        },
        cancellationToken
      );
      return this.convert(rawResponse);
    } catch (e) {
      relatedFilesLogger.exception(this.context, e, '.copilotRelated');
      return null;
    }
  }

  static async relatedCapabilityTelemetry(
    ctx: Context,
    telemetryData: TelemetryData,
    hasRelatedCapability: boolean
  ): Promise<void> {
    try {
      if (!hasRelatedCapability || AgentRelatedFilesProvider.telemetrySent) return;
      AgentRelatedFilesProvider.telemetrySent = true;
      telemetry(ctx, 'copilotRelated.hasRelatedCapability', telemetryData);
    } catch (e) {
      relatedFilesLogger.exception(ctx, e, 'copilotRelated');
    }
  }
}

export { AgentRelatedFilesProvider };
