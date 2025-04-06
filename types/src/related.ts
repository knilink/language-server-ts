import { ProtocolRequestType } from 'vscode-languageserver-protocol';
import { DocumentUri } from 'vscode-languageserver-types';
import { TelemetryMeasurements, TelemetryProperties } from '../../lib/src/types.ts';

// ../../lib/src/prompt/contextProviders/traits.ts
type Trait = {
  name: string;
  value: string;
  // optional trait.promptTextOverride ../../lib/src/prompt/similarFiles/neighborFiles.ts
  promptTextOverride?: string;
  includeInPrompt: boolean;
};

type RawEntry = {
  providerName: string;
  uris: DocumentUri[];
};

type Entry = {
  uris: DocumentUri[];
  type: 'related/csharp' | 'related/csharproslyn' | 'related/cpp' | 'related/cppsemanticcodecontext' | 'related/other';
};

type RelatedParames = {
  textDocument: { uri: DocumentUri };
  // ../../agent/src/agentRelatedFilesProvider.ts
  data: unknown;
  // ../../agent/src/agentRelatedFilesProvider.ts
  telemetry: { properties: TelemetryProperties; measurements: TelemetryMeasurements };
};
type RawResponse = { entries: RawEntry[]; traits: Trait[] };

namespace CopilotRelatedRequest {
  export const method = 'copilot/related';
  export const type = new ProtocolRequestType<RelatedParames, RawResponse, unknown, unknown, unknown>(method);
}

export { CopilotRelatedRequest, RawResponse, RawEntry, Trait, Entry };
