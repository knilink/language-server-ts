import { Context } from '../context.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { EditorAndPluginInfo } from '../config.ts';

function getIntegrationId(editorAndPluginInfo: EditorAndPluginInfo): EditorAndPluginInfo.IntegrationId | undefined {
  let copilotIntegrationId = editorAndPluginInfo.getCopilotIntegrationId();
  if (copilotIntegrationId) {
    return copilotIntegrationId;
  }
  switch (editorAndPluginInfo.getEditorPluginInfo().name) {
    case 'copilot-intellij':
      return 'jetbrains-chat';
    case 'copilot-xcode':
      return 'xcode-chat';
    case 'copilot-eclipse':
      return 'copilot-eclipse';
    case 'copilot':
    case 'copilot-vs':
      return;
    default:
      return 'copilot-language-server';
  }
}

class CapiVersionHeaderContributor {
  constructor(readonly ctx: Context) {}

  contributeHeaderValues(url: string, headers: Record<string, string>): void {
    const capiUrl = this.ctx.get(NetworkConfiguration).getCAPIUrl(this.ctx);
    if (this.isBlackbirdEndpoint(url)) {
      headers['Copilot-Integration-Id'] = this.ctx.get(EditorAndPluginInfo).getEditorInfo().name;
      headers['X-GitHub-Api-Version'] = '2023-12-12-preview';
    } else if (url.startsWith(capiUrl)) {
      headers['X-GitHub-Api-Version'] = '2025-01-21';
      const integrationId = this.getIntegrationId();
      if (integrationId) {
        headers['Copilot-Integration-Id'] = integrationId;
      }
    }
  }

  isBlackbirdEndpoint(endpoint: string): boolean {
    const codeSearchEndpoint = this.ctx.get(NetworkConfiguration).getBlackbirdCodeSearchUrl(this.ctx);
    const docsSearchEndpoint = this.ctx.get(NetworkConfiguration).getBlackbirdDocsSearchUrl(this.ctx);
    return endpoint === codeSearchEndpoint || endpoint === docsSearchEndpoint;
  }

  getIntegrationId(): string | undefined {
    return getIntegrationId(this.ctx.get(EditorAndPluginInfo));
  }
}

export { CapiVersionHeaderContributor };
