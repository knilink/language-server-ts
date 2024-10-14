import { ProtocolRequestType } from 'vscode-languageserver-protocol';
import { DocumentUri } from 'vscode-languageserver-types';

type Trait = { name: string; value: string; promptTextOverride: string; includeInPrompt: boolean };

type RawEntry = {
  providerName: string;
  uris: DocumentUri[];
};

type Entry = {
  uris: DocumentUri[];
  type: 'related/csharp' | 'related/csharproslyn' | 'related/cpp' | 'related/cppsemanticcodecontext' | 'related/other';
};

type RelatedParames = { textDocument: { uri: DocumentUri }; data: never };
type RawResponse = { entries: RawEntry[]; traits: Trait[] };

namespace CopilotRelatedRequest {
  export const method = 'copilot/related';
  export const type = new ProtocolRequestType<RelatedParames, RawResponse, unknown, unknown, unknown>(method);
}

export { CopilotRelatedRequest, RawResponse, RawEntry, Trait, Entry };
