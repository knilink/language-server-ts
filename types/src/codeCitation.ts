import type { Range, DocumentUri } from 'vscode-languageserver-types';

import { NotificationType } from 'vscode-languageserver-protocol';

namespace CopilotIPCodeCitationNotification {
  interface CopilotIPCodeCitationParams {
    uri: DocumentUri;
    version?: number;
    range: Range;
    matchingText: string;
    citations?: {
      // ../../agent/src/citationManager.ts
      license: string;
      // ../../agent/src/citationManager.ts
      url: string;
    }[];
  }

  export const method = 'copilot/ipCodeCitation';
  export const type = new NotificationType<CopilotIPCodeCitationParams>(CopilotIPCodeCitationNotification.method);
}

export { CopilotIPCodeCitationNotification };
