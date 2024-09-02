import { type Context } from '../../context.ts';
import { RemoteAgentRegistry, CapiRemoteAgentRegistry } from './remoteAgents.ts';

function activateExtensibilityPlatformFeature(ctx: Context): void {
  registerContextDependencies(ctx);
}

function registerContextDependencies(ctx: Context): void {
  ctx.set(RemoteAgentRegistry, new CapiRemoteAgentRegistry(ctx));
}

export { activateExtensibilityPlatformFeature };
