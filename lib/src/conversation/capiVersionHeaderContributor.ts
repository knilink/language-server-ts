import { Context } from '../context.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { EditorAndPluginInfo } from '../config.ts';

class CapiVersionHeaderContributor {
  constructor(readonly ctx: Context) {}

  contributeHeaderValues(url: string, headers: Record<string, string>): void {
    const capiUrl = this.ctx.get(NetworkConfiguration).getCAPIUrl(this.ctx);
    if (this.isBlackbirdEndpoint(url)) {
      headers['Copilot-Integration-Id'] = this.ctx.get(EditorAndPluginInfo).getEditorInfo().name;
      headers['X-GitHub-Api-Version'] = '2023-12-12-preview';
    } else if (url.startsWith(capiUrl)) {
      headers['X-GitHub-Api-Version'] = '2023-07-07';
    }
  }

  isBlackbirdEndpoint(endpoint: string): boolean {
    const codeSearchEndpoint = this.ctx.get(NetworkConfiguration).getBlackbirdCodeSearchUrl(this.ctx);
    const docsSearchEndpoint = this.ctx.get(NetworkConfiguration).getBlackbirdDocsSearchUrl(this.ctx);
    return endpoint === codeSearchEndpoint || endpoint === docsSearchEndpoint;
  }
}

export { CapiVersionHeaderContributor };
