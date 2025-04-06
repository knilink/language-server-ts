import type { Context } from '../../lib/src/context.ts';
import type { Citation } from '../../lib/src/citationManager.ts';

import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { Service } from './service.ts';
import { CitationManager } from '../../lib/src/citationManager.ts';
import { Logger } from '../../lib/src/logger.ts';
import { CopilotIPCodeCitationNotification } from '../../types/src/codeCitation.ts';
import type {} from '../../types/src/index.ts';

const citationLogger = new Logger('Public Code References');

class CLSCitationManager extends CitationManager {
  async handleIPCodeCitation(ctx: Context, citation: Citation) {
    const ln = citation.location?.start.line !== undefined ? citation.location.start.line + 1 : '-';

    const col = citation.location?.start.character !== undefined ? citation.location.start.character + 1 : '-';

    const text = (citation.matchingText ?? '').replace(/[\r\n]/g, ' ');

    citationLogger.info(
      ctx,
      `Text found matching public code in ${citation.inDocumentUri} [Ln ${ln}, Col ${col}] near ${text}...:` +
        citation.details.map((d, idx) => `\n  ${idx + 1}) [${d.license}] ${d.url}`).join('')
    );

    if (
      !(citation.version === undefined || citation.location === undefined) &&
      ctx.get(CopilotCapabilitiesProvider).getCapabilities().ipCodeCitation === true
    ) {
      await ctx.get(Service).connection.sendNotification(CopilotIPCodeCitationNotification.type, {
        uri: citation.inDocumentUri,
        version: citation.version,
        range: citation.location,
        matchingText: citation.matchingText ?? '',
        citations: citation.details,
      });
    }
  }
}

export { CLSCitationManager };
