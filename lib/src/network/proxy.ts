import { Type, type Static } from '@sinclair/typebox';
import net from 'net';
import { type Fetcher } from '../networking';

const HttpSettings = Type.Object({
  proxy: Type.Optional(Type.String()),
  proxyStrictSSL: Type.Optional(Type.Boolean()),
  proxyAuthorization: Type.Optional(Type.String()),
  proxyKerberosServicePrincipal: Type.Optional(Type.String()),
});

type HttpSettingsType = Static<typeof HttpSettings>;

function getProxyFromEnvironment(env: Record<string, string | undefined>): string | undefined {
  return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
}

function getRejectUnauthorizedFromEnvironment(env: Record<string, string | undefined>): boolean {
  return env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';
}

function getHttpSettingsFromEnvironment(env: Record<string, string | undefined>): HttpSettingsType {
  const spnEnv =
    (env.GH_COPILOT_KERBEROS_SERVICE_PRINCIPAL || env.GITHUB_COPILOT_KERBEROS_SERVICE_PRINCIPAL) ??
    env.AGENT_KERBEROS_SERVICE_PRINCIPAL;

  const httpSettings: HttpSettingsType = {
    proxy: getProxyFromEnvironment(env),
    proxyStrictSSL: getRejectUnauthorizedFromEnvironment(env),
  };

  if (spnEnv) {
    httpSettings.proxyKerberosServicePrincipal = spnEnv;
  }

  return httpSettings;
}

function proxySettingFromUrl(proxyUrl: string): Fetcher.ProxySetting {
  if (net.isIPv6(proxyUrl)) {
    proxyUrl = 'https://[' + proxyUrl + ']';
  } else if (!/:\/\//.test(proxyUrl)) {
    proxyUrl = `https://${proxyUrl}`;
  }

  const urlObj = new URL(proxyUrl);
  const { hostname, port, username, password } = urlObj;
  return {
    host: hostname,
    port: parsePort(port),
    proxyAuth: getAuth(username, password),
  };
}

function parsePort(port?: string): number {
  if (!port) return 80;
  const portNumber = Number(port);
  if (isNaN(portNumber)) throw new TypeError('Invalid proxy port');
  return portNumber;
}

function getAuth(username?: string, password?: string): string | undefined {
  return username && password ? `${decodeURIComponent(username)}:${decodeURIComponent(password)}` : '';
}

export { getProxyFromEnvironment, proxySettingFromUrl, getHttpSettingsFromEnvironment, HttpSettings };
