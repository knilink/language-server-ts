import { type Context } from '../../context';
import { RemoteAgentRegistry, CapiRemoteAgentRegistry } from './remoteAgents';

function activateExtensibilityPlatformFeature(ctx: Context): void {
  registerContextDependencies(ctx);
}

function registerContextDependencies(ctx: Context): void {
  ctx.set(RemoteAgentRegistry, new CapiRemoteAgentRegistry(ctx));
}

export { activateExtensibilityPlatformFeature };
