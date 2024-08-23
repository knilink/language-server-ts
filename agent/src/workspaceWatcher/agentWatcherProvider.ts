import type { URI } from 'vscode-uri';

import { CopilotCapabilitiesProvider } from '../editorFeatures/capabilities';
import { AgentWorkspaceWatcher } from './agentWatcher';

import { WorkspaceWatcherProvider } from '../../../lib/src/workspaceWatcherProvider';
// import { } from '../editorFeatures/capabilities';

class AgentWorkspaceWatcherProvider extends WorkspaceWatcherProvider {
  createWatcher(workspaceFolder: URI): AgentWorkspaceWatcher {
    return new AgentWorkspaceWatcher(this.ctx, workspaceFolder);
  }

  shouldStartWatching(workspaceFolder: URI): boolean {
    return (
      !!this.ctx.get(CopilotCapabilitiesProvider).getCapabilities().watchedFiles &&
      (!this.hasWatcher(workspaceFolder) || this.getStatus(workspaceFolder) === 'stopped')
    );
  }
}

export { AgentWorkspaceWatcherProvider };
