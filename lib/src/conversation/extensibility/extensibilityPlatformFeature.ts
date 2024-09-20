import { type Context } from '../../context.ts';
import { RemoteAgentRegistry, CapiRemoteAgentRegistry } from './remoteAgentRegistry.ts';
import { GitHubRepositoryApi } from '../gitHubRepositoryApi.ts';

function activateExtensibilityPlatformFeature(ctx: Context): void {
  registerContextDependencies(ctx);
}

function registerContextDependencies(ctx: Context): void {
  ctx.set(RemoteAgentRegistry, new CapiRemoteAgentRegistry(ctx));
  ctx.set(GitHubRepositoryApi, new GitHubRepositoryApi(ctx));
}

export { activateExtensibilityPlatformFeature };
