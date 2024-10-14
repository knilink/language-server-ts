import type { URI } from 'vscode-uri';

import { CopilotCapabilitiesProvider } from '../editorFeatures/capabilities.ts';
import { AgentWorkspaceWatcher } from './agentWatcher.ts';

import { WorkspaceWatcherProvider } from '../../../lib/src/workspaceWatcherProvider.ts';
import { WorkspaceFolder } from 'vscode-languageserver-types';
// import { } from '../editorFeatures/capabilities';

class AgentWorkspaceWatcherProvider extends WorkspaceWatcherProvider {
  createWatcher(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): AgentWorkspaceWatcher {
    return new AgentWorkspaceWatcher(this.ctx, workspaceFolder);
  }

  shouldStartWatching(workspaceFolder: Pick<WorkspaceFolder, 'uri'>): boolean {
    return (
      !!this.ctx.get(CopilotCapabilitiesProvider).getCapabilities().watchedFiles &&
      (!this.hasWatcher(workspaceFolder) || this.getStatus(workspaceFolder) === 'stopped')
    );
  }
}

export { AgentWorkspaceWatcherProvider };
