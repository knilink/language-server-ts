import { Type, type Static } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Context } from "../../../lib/src/context.ts";

import { NetworkConfiguration } from "../../../lib/src/networkConfiguration.ts";
import { logger } from "../service.ts";
import { AgentConfigProvider } from "../config.ts";
import { ConfigKey, getConfigKeyRecursively } from "../../../lib/src/config.ts";
import { Fetcher } from "../../../lib/src/networking.ts";
import { getHttpSettingsFromEnvironment, proxySettingFromUrl, HttpSettings } from "../../../lib/src/network/proxy.ts";
import { TestingOptions } from "./testingOptions.ts";
import { SchemaValidationError } from "../schemaValidation.ts";
import { AgentInstallationManager } from "../installationManager.ts";

const NetworkProxy = Type.Object({
  host: Type.String(),
  port: Type.Number(),
  username: Type.Optional(Type.String()),
  password: Type.Optional(Type.String()),
  rejectUnauthorized: Type.Optional(Type.Boolean()),
});
const GitHubEnterpriseSettings = Type.Object({ uri: Type.Optional(Type.String()) });
const EditorConfigurationSettings = Type.Object({
  showEditorCompletions: Type.Optional(Type.Boolean()),
  enableAutoCompletions: Type.Optional(Type.Boolean()),
  delayCompletions: Type.Optional(Type.Boolean()),
  filterCompletions: Type.Optional(Type.Boolean()),
  github: Type.Optional(Type.Object({ copilot: Type.Optional(Type.Object({})) })),
  'github-enterprise': Type.Optional(GitHubEnterpriseSettings),
  githubEnterprise: Type.Optional(GitHubEnterpriseSettings),
  http: Type.Optional(HttpSettings),
});
const AuthProvider = Type.Object({ url: Type.Optional(Type.String()) });
const Params = Type.Object({
  settings: Type.Optional(Type.Union([Type.Object({}), Type.Array(Type.Unknown(), { maxItems: 0 })])),
  networkProxy: Type.Optional(NetworkProxy),
  authProvider: Type.Optional(AuthProvider),
  options: Type.Optional(TestingOptions),
});
const typeCheck = TypeCompiler.Compile(Params);
const typeCheckEditorConfiguration = TypeCompiler.Compile(EditorConfigurationSettings);

async function notifyChangeConfiguration(ctx: Context, params: unknown): Promise<void> {
  if (!typeCheck.Check(params)) throw new SchemaValidationError(typeCheck.Errors(params));

  if (Array.isArray(params.settings)) applySettingsToConfiguration(ctx, {});
  else if (params.settings) applySettingsToConfiguration(ctx, params.settings);

  if (params.networkProxy) {
    applyNetworkProxyConfiguration(ctx, params.networkProxy);
  }
  if (params.authProvider) {
    ctx.get(NetworkConfiguration).updateBaseUrl(ctx, params.authProvider.url);
  }

  await initializePostConfigurationDependencies(ctx);
}

// ./setEditorInfo.ts
function applySettingsToConfiguration(ctx: Context, settings: Record<string, unknown>): void {
  const errors = typeCheckEditorConfiguration.Errors(settings);
  for (const error of errors) {
    const topLevelKey = error.path.split('/')?.[1];
    logger.warn(ctx, `Invalid ${error.path.slice(1).replaceAll('/', '.')} setting:`, error.message);

    delete settings[topLevelKey];
  }

  if (!typeCheckEditorConfiguration.Check(settings)) {
    throw new SchemaValidationError(typeCheckEditorConfiguration.Errors(settings));
  }

  const config = ctx.get(AgentConfigProvider);
  config.setConfig(ConfigKey.ShowEditorCompletions, settings.showEditorCompletions);
  config.setConfig(ConfigKey.DelayCompletions, settings.delayCompletions);
  config.setConfig(ConfigKey.EnableAutoCompletions, settings.enableAutoCompletions);
  config.setConfig(ConfigKey.FilterCompletions, settings.filterCompletions);

  const authProvider = settings['github-enterprise'] ?? settings.githubEnterprise;
  if (authProvider) {
    ctx.get(NetworkConfiguration).updateBaseUrl(ctx, authProvider.uri!);
  }
  if (settings.http) applyHttpConfiguration(ctx, settings.http);
  if (settings.github?.copilot) applyCopilotConfiguration(ctx, settings.github.copilot);
}

function applyCopilotConfiguration(ctx: Context, copilot: unknown): void {
  const configProvider = ctx.get(AgentConfigProvider);
  for (const key of Object.values(ConfigKey)) {
    const value = getConfigKeyRecursively(copilot, key); // MARK type unsafe
    configProvider.setConfig(key, value);
  }
}

function applyHttpConfiguration(ctx: Context, http: Static<typeof HttpSettings>): void {
  const config = ctx.get(AgentConfigProvider);
  const fetcher = ctx.get(Fetcher);

  if (http.proxy === undefined) {
    http = getHttpSettingsFromEnvironment(config.env);
  }
  fetcher.rejectUnauthorized = http?.proxyStrictSSL;
  if (!http.proxy) {
    fetcher.proxySettings = undefined;
    return;
  }

  try {
    fetcher.proxySettings = proxySettingFromUrl(http.proxy!);
    if (http.proxyAuthorization) {
      fetcher.proxySettings.proxyAuth = http.proxyAuthorization;
    }
    if (http.proxyKerberosServicePrincipal) {
      fetcher.proxySettings.kerberosServicePrincipal = http.proxyKerberosServicePrincipal;
    }
  } catch (e: unknown) {
    if (!(e instanceof TypeError)) throw e;
    logger.warn(ctx, 'Invalid proxy URL', http.proxy, e);
    fetcher.proxySettings = undefined;
  }
}

function applyNetworkProxyConfiguration(ctx: Context, proxySettings?: Static<typeof NetworkProxy>): void {
  const fetcher = ctx.get(Fetcher);
  if (!proxySettings) {
    fetcher.proxySettings = undefined;
    fetcher.rejectUnauthorized = undefined;
    return;
  }

  let authentication: string | undefined;
  if (proxySettings.username) {
    authentication = proxySettings.password
      ? `${proxySettings.username}:${proxySettings.password}`
      : proxySettings.username;
  }

  fetcher.proxySettings = {
    host: proxySettings.host,
    port: proxySettings.port,
    proxyAuth: authentication,
  };
  fetcher.rejectUnauthorized = proxySettings.rejectUnauthorized ?? true;
}

async function initializePostConfigurationDependencies(ctx: Context): Promise<void> {
  await new AgentInstallationManager().startup(ctx);
}

export {
  notifyChangeConfiguration,
  applyHttpConfiguration,
  applySettingsToConfiguration,
  applyNetworkProxyConfiguration,
  initializePostConfigurationDependencies,
  NetworkProxy,
  AuthProvider,
};
