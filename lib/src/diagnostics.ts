import * as os from 'node:os';
import * as tls from 'node:tls';

import { type Context } from './context.ts';

import { getVersion, getBuildType, editorVersionHeaders } from './config.ts';
import { CopilotTokenManager } from './auth/copilotTokenManager.ts';
import { Fetcher } from './networking.ts';
import { checkReachability } from './reachability.ts';

type DiagnosticData = {
  sections: DiagnosticSection[];
};

type DiagnosticSection = {
  name: string;
  items: Record<string, unknown>;
};

async function collectDiagnostics(ctx: Context): Promise<DiagnosticData> {
  return {
    sections: [
      collectCopilotSection(ctx),
      collectEnvironmentSection(),
      await collectFeatureFlagsSection(ctx),
      collectNodeSection(),
      collectNetworkConfigSection(ctx),
      await collectReachabilitySection(ctx),
    ],
  };
}

function formatDiagnosticsAsMarkdown(data: DiagnosticData): string {
  return data.sections.map(formatSectionAsMarkdown).join(`${os.EOL}${os.EOL}`);
}

function collectCopilotSection(ctx: Context): DiagnosticSection {
  return {
    name: 'Copilot',
    items: {
      Version: getVersion(ctx),
      Build: getBuildType(ctx),
      Editor: editorVersionHeaders(ctx)['Editor-Version'],
    },
  };
}

function collectEnvironmentSection(): DiagnosticSection {
  return {
    name: 'Environment',
    items: {
      http_proxy: findEnvironmentVariable('http_proxy'),
      https_proxy: findEnvironmentVariable('https_proxy'),
      no_proxy: findEnvironmentVariable('no_proxy'),
      SSL_CERT_FILE: findEnvironmentVariable('SSL_CERT_FILE'),
      SSL_CERT_DIR: findEnvironmentVariable('SSL_CERT_DIR'),
      OPENSSL_CONF: findEnvironmentVariable('OPENSSL_CONF'),
    },
  };
}

function collectNodeSection(): DiagnosticSection {
  return {
    name: 'Node setup',
    items: {
      'Number of root certificates': tls.DEFAULT_MIN_VERSION,
      'Operating system': os.type(),
      'Operating system version': os.release(),
      'Operating system architecture': os.arch(),
      NODE_OPTIONS: findEnvironmentVariable('NODE_OPTIONS'),
      NODE_EXTRA_CA_CERTS: findEnvironmentVariable('NODE_EXTRA_CA_CERTS'),
      NODE_TLS_REJECT_UNAUTHORIZED: findEnvironmentVariable('NODE_TLS_REJECT_UNAUTHORIZED'),
      'tls default min version': tls.DEFAULT_MIN_VERSION,
      'tls default max version': tls.DEFAULT_MAX_VERSION,
    },
  };
}

async function collectFeatureFlagsSection(ctx: Context): Promise<DiagnosticSection> {
  const items: Record<string, unknown> = {};
  try {
    const token = await ctx.get(CopilotTokenManager).getToken();
    items['Send Restricted Telemetry'] = token.getTokenValue('rt') === '1' ? 'enabled' : 'disabled';
    items.Chat = token.envelope?.chat_enabled ? 'enabled' : undefined;
    items['Content exclusion'] = token.envelope?.copilotignore_enabled ? 'enabled' : 'unavailable';
  } catch {}

  return { name: 'Feature Flags', items };
}

function collectNetworkConfigSection(ctx: Context): DiagnosticSection {
  const fetcher = ctx.get(Fetcher);
  return {
    name: 'Network Configuration',
    items: {
      'Proxy host': fetcher.proxySettings?.host,
      'Proxy port': fetcher.proxySettings?.port,
      'Kerberos SPN': fetcher.proxySettings?.kerberosServicePrincipal,
      'Reject unauthorized': fetcher.rejectUnauthorized ? 'enabled' : 'disabled',
      Fetcher: fetcher.name,
    },
  };
}

async function collectReachabilitySection(ctx: Context): Promise<DiagnosticSection> {
  const reachabilityResults = await checkReachability(ctx);
  return {
    name: 'Reachability',
    items: Object.fromEntries(reachabilityResults.map(({ label, status, message }) => [label, message])),
  };
}

function findEnvironmentVariable(name: string): string | undefined {
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? process.env[key] : undefined;
}

function formatSectionAsMarkdown(section: DiagnosticSection): string {
  return (
    `## ${section.name}` +
    `${os.EOL}${os.EOL}` +
    Object.keys(section.items)
      .filter((k) => k !== 'name')
      .map((k) => `- ${k}: ${section.items[k] ?? 'n/a'}`)
      .join(os.EOL)
  );
}

export { collectDiagnostics, findEnvironmentVariable, formatDiagnosticsAsMarkdown };
