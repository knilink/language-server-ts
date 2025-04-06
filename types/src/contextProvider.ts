import type { SupportedContextItemTypeUnion } from '../../lib/src/prompt/contextProviders/contextItemSchemas.ts';
import type { Position, DocumentUri } from 'vscode-languageserver-types';
import type { UUID } from 'node:crypto';

import { ProtocolRequestType } from 'vscode-languageserver-protocol';

namespace ContextUpdateRequest {
  interface RequestParams {
    providerId: string;
    data: unknown;
    textDocument: {
      uri: DocumentUri;
      languageId: string;
      version: number;
    };
    position: Position;
    partialResultToken: UUID;
  }

  export const method = 'context/update';
  export const type = new ProtocolRequestType<
    RequestParams,
    SupportedContextItemTypeUnion[],
    SupportedContextItemTypeUnion[],
    unknown,
    unknown
  >(ContextUpdateRequest.method);
}

export { ContextUpdateRequest };
