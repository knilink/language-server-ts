import { type CancellationToken } from '../cancellation.ts';
import { Type, type Static } from '@sinclair/typebox';

import { type Context } from '../../../lib/src/context.ts';
import { EditorAndPluginInfo } from '../../../lib/src/config.ts';
import {
  applySettingsToConfiguration,
  applyNetworkProxyConfiguration,
  initializePostConfigurationDependencies,
  NetworkProxy,
  AuthProvider,
} from './notifyChangeConfiguration.ts';
import { Fetcher } from '../../../lib/src/networking.ts';
import { AgentConfigProvider } from '../config.ts';
import { getProxyFromEnvironment, proxySettingFromUrl } from '../../../lib/src/network/proxy.ts';
import { NetworkConfiguration } from '../../../lib/src/networkConfiguration.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';

const NameAndVersionParam = Type.Object({
  name: Type.String(),
  version: Type.String(),
  readableName: Type.Optional(Type.String()),
});

const Params = Type.Object({
  editorInfo: NameAndVersionParam,
  editorPluginInfo: NameAndVersionParam,
  editorConfiguration: Type.Optional(Type.Object({})),
  networkProxy: Type.Optional(NetworkProxy),
  authProvider: Type.Optional(AuthProvider),
  redirectTelemetry: Type.Optional(Type.Boolean()),
  options: Type.Optional(Type.Object({})),
});

const handleSetEditorInfoChecked = async (
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> => {
  ctx.get(EditorAndPluginInfo).setEditorAndPluginInfo(params.editorInfo, params.editorPluginInfo);

  if (params.editorConfiguration) {
    applySettingsToConfiguration(ctx, params.editorConfiguration);
  }

  const fetcher = ctx.get(Fetcher);
  const env = ctx.get(AgentConfigProvider).env;
  const envProxyUrl = getProxyFromEnvironment(env);

  if (params.editorInfo.name === 'VisualStudio') {
    if (envProxyUrl) {
      fetcher.proxySettings = proxySettingFromUrl(envProxyUrl);
    } else if (params.networkProxy) {
      applyNetworkProxyConfiguration(ctx, params.networkProxy);
      const spnEnv =
        env.GH_COPILOT_KERBEROS_SERVICE_PRINCIPAL ??
        env.GITHUB_COPILOT_KERBEROS_SERVICE_PRINCIPAL ??
        env.AGENT_KERBEROS_SERVICE_PRINCIPAL;
      if (fetcher.proxySettings && spnEnv && !fetcher.proxySettings.kerberosServicePrincipal) {
        fetcher.proxySettings.kerberosServicePrincipal = spnEnv;
      }
    }
  } else {
    if (params.networkProxy) {
      applyNetworkProxyConfiguration(ctx, params.networkProxy);
    } else if (envProxyUrl) {
      fetcher.proxySettings = proxySettingFromUrl(envProxyUrl);
    }
  }

  if (params.authProvider) {
    ctx.get(NetworkConfiguration).updateBaseUrl(ctx, params.authProvider.url);
  }

  await initializePostConfigurationDependencies(ctx, params.editorConfiguration);
  return ['OK', null];
};

const handleSetEditorInfo = addMethodHandlerValidation(Params, handleSetEditorInfoChecked);

export { handleSetEditorInfo };
