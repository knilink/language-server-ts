import assert from 'assert';

import { Context } from './context.ts';
import { NetworkConfiguration } from './networkConfiguration.ts';

import { onCopilotToken } from './auth/copilotTokenNotifier.ts';
import { isProduction, getConfig, ConfigKey, type ConfigKeysByType } from './config.ts';
import { NotificationSender } from './notificationSender.ts';
import { CopilotTokenManager } from './auth/copilotTokenManager.ts';
import { TelemetryInitialization } from './telemetry/setupTelemetryReporters.ts';
import { isRunningInTest } from './testing/runtimeMode.ts';
import { GitHubToken } from './auth/types.ts';
import { CopilotToken } from './auth/copilotToken.ts';

const DotComAuthority = 'github.com';
const DotComUrl = `https://${DotComAuthority}`;
const CAPIDotComUrl = 'https://api.githubcopilot.com';
const TelemetryDotComUrl = 'https://copilot-telemetry.githubusercontent.com/telemetry';
const ExperimentationDotComUrl = 'https://copilot-telemetry.githubusercontent.com/telemetry';
const OpenAIProxyUrl = 'https://copilot-proxy.githubusercontent.com';

class DefaultNetworkConfiguration extends NetworkConfiguration {
  isEnterprise?: boolean;
  baseUrlObject?: URL;
  apiUrl?: string;
  tokenUrl?: string;
  notificationUrl?: string;
  contentRestrictionsUrl?: string;
  blackbirdIndexingStatusUrl?: string;
  loginReachabilityUrl?: string;
  deviceFlowStartUrl?: string;
  deviceFlowCompletionUrl?: string;
  userInfoUrl?: string;
  capiUrl?: string;
  telemetryUrl?: string;
  completionsUrl?: string;
  originTrackerUrl?: string;
  signUpLimitedUrl?: string;
  experimentationUrl?: string;

  constructor(
    ctx: Context,
    url = DotComUrl,
    readonly env = process.env
  ) {
    super();
    this.recalculateUrlDefaults(url);
    onCopilotToken(ctx, (token) => this.onCopilotToken(ctx, token));
  }

  onCopilotToken(ctx: Context, token: CopilotToken): void {
    if (token.envelope.endpoints) {
      this.updateServiceEndpoints(ctx, token.envelope.endpoints);
    }
  }

  isGitHubEnterprise(): boolean {
    assert(this.isEnterprise);
    return this.isEnterprise;
  }

  getAuthAuthority(): string {
    assert(this.baseUrlObject);
    return this.baseUrlObject.host;
  }

  getAPIUrl(path?: string): string {
    assert(this.apiUrl);
    return this.join(this.apiUrl, path);
  }

  getTokenUrl(githubToken: GitHubToken): string {
    const url = githubToken.devOverride?.copilotTokenUrl ?? this.tokenUrl;
    assert(url);
    return url;
  }

  getNotificationUrl(githubToken: GitHubToken): string {
    const url = githubToken.devOverride?.notificationUrl ?? this.notificationUrl;
    assert(url);
    return url;
  }

  getContentRestrictionsUrl(githubToken: GitHubToken): string {
    const url = githubToken.devOverride?.contentRestrictionsUrl ?? this.contentRestrictionsUrl;
    assert(url);
    return url;
  }

  getBlackbirdIndexingStatusUrl(): string {
    assert(this.blackbirdIndexingStatusUrl);
    return this.blackbirdIndexingStatusUrl;
  }

  getLoginReachabilityUrl(): string {
    assert(this.loginReachabilityUrl);
    return this.loginReachabilityUrl;
  }

  getDeviceFlowStartUrl(): string {
    assert(this.deviceFlowStartUrl);
    return this.deviceFlowStartUrl;
  }

  getDeviceFlowCompletionUrl(): string {
    assert(this.deviceFlowCompletionUrl);
    return this.deviceFlowCompletionUrl;
  }

  getSignUpLimitedUrl(): string {
    assert(this.signUpLimitedUrl);
    return this.signUpLimitedUrl;
  }

  getUserInfoUrl(): string {
    assert(this.userInfoUrl);
    return this.userInfoUrl;
  }

  getCAPIUrl(ctx: Context, path: string): string {
    assert(this.capiUrl);
    const url = this.urlOrConfigOverride(
      ctx,
      this.capiUrl,
      [ConfigKey.DebugOverrideCapiUrl, ConfigKey.DebugOverrideCapiUrlLegacy],
      [ConfigKey.DebugTestOverrideCapiUrl, ConfigKey.DebugTestOverrideCapiUrlLegacy]
    );
    return this.join(url, path);
  }

  getBlackbirdCodeSearchUrl(ctx: Context): string {
    return this.getCAPIUrl(ctx, '/search/code');
  }

  getBlackbirdDocsSearchUrl(ctx: Context): string {
    return this.getCAPIUrl(ctx, '/search/docs');
  }

  getEmbeddingsUrl(ctx: Context): string {
    return this.getCAPIUrl(ctx, '/embeddings');
  }

  getTelemetryUrl(path: string): string {
    assert(this.telemetryUrl);
    return this.join(this.telemetryUrl, path);
  }

  setTelemetryUrlForTesting(url: string): void {
    this.telemetryUrl = url;
  }

  getExperimentationUrl(path?: string) {
    assert(this.experimentationUrl);
    return this.join(this.experimentationUrl, path);
  }

  getCompletionsUrl(ctx: Context, path: string): string {
    assert(this.completionsUrl);
    const url = this.urlOrConfigOverride(
      ctx,
      this.completionsUrl,
      [ConfigKey.DebugOverrideProxyUrl, ConfigKey.DebugOverrideProxyUrlLegacy],
      [ConfigKey.DebugTestOverrideProxyUrl, ConfigKey.DebugTestOverrideProxyUrlLegacy]
    );
    return this.join(url, path);
  }

  getSnippetRetrievalUrl(ctx: Context, repoNwo: string, serverRouteImpl: string): string {
    let url = new URL(this.getCompletionsUrl(ctx, 'v0/retrieval'));
    url.search = new URLSearchParams({ repo: repoNwo, impl: serverRouteImpl }).toString();
    return url.href;
  }

  updateBaseUrl(ctx: Context, newUrl: string = DotComUrl): void {
    assert(this.baseUrlObject);
    const oldUrl = this.baseUrlObject;

    if (!this.isPermittedUrl(ctx, newUrl)) {
      ctx.get(NotificationSender).showWarningMessage(`Ignoring invalid or unsupported authentication URL "${newUrl}".`);
      return;
    }

    this.withTelemetryReInitialization(ctx, () => {
      assert(this.baseUrlObject);
      this.recalculateUrlDefaults(newUrl);
      if (oldUrl.href !== this.baseUrlObject.href) {
        ctx.get(CopilotTokenManager).resetToken();
      }
    });
  }

  updateBaseUrlFromTokenEndpoint(ctx: Context, tokenUrl: string): void {
    try {
      let endpoint = new URL(tokenUrl);

      if (endpoint.hostname.startsWith('api.')) {
        this.updateBaseUrl(ctx, `https://${endpoint.hostname.substring(4)}`);
      } else {
        this.updateBaseUrl(ctx);
      }
    } catch {
      this.updateBaseUrl(ctx);
    }
  }

  updateServiceEndpoints(
    ctx: Context,
    endpoints: { api: string; proxy: string; 'origin-tracker': string; telemetry: string }
  ): void {
    if (this.isPermittedUrl(ctx, endpoints.api)) this.capiUrl = endpoints.api;

    if (this.isPermittedUrl(ctx, endpoints.proxy)) this.completionsUrl = endpoints.proxy;

    if (this.isPermittedUrl(ctx, endpoints.telemetry)) {
      this.withTelemetryReInitialization(ctx, () => {
        this.telemetryUrl = this.join(endpoints.telemetry, 'telemetry');
        this.experimentationUrl = this.join(endpoints.telemetry, 'telemetry');
      });
    }
  }

  withTelemetryReInitialization(ctx: Context, fn: () => void): void {
    const origUrl = this.telemetryUrl;
    fn();
    if (origUrl === this.telemetryUrl) return;
    const telemetry = ctx.get(TelemetryInitialization);
    if (telemetry.isInitialized) telemetry.reInitialize(ctx);
  }

  recalculateUrlDefaults(url: string): void {
    const urls = this.parseUrls(url);
    this.baseUrlObject = urls.base;
    let apiUrl = urls.api;
    this.isEnterprise = this.baseUrlObject.host !== DotComAuthority;
    this.apiUrl = apiUrl.href;
    this.tokenUrl = this.join(apiUrl.href, '/copilot_internal/v2/token');
    this.notificationUrl = this.join(apiUrl.href, '/copilot_internal/notification');
    this.contentRestrictionsUrl = this.join(apiUrl.href, '/copilot_internal/content_exclusion');
    this.blackbirdIndexingStatusUrl = this.join(apiUrl.href, '/copilot_internal/check_indexing_status');
    this.loginReachabilityUrl = this.join(this.baseUrlObject.href, '/login/device');
    this.deviceFlowStartUrl = this.join(this.baseUrlObject.href, '/login/device/code');
    this.deviceFlowCompletionUrl = this.join(this.baseUrlObject.href, '/login/oauth/access_token');
    this.userInfoUrl = this.join(apiUrl.href, '/user');
    this.signUpLimitedUrl = this.join(apiUrl.href, '/copilot_internal/subscribe_limited_user');
    this.capiUrl = this.isEnterprise ? this.prefixWith('copilot-api.', this.baseUrlObject).href : CAPIDotComUrl;
    this.telemetryUrl = this.isEnterprise
      ? this.join(this.prefixWith('copilot-telemetry-service.', this.baseUrlObject).href, '/telemetry')
      : TelemetryDotComUrl;
    this.experimentationUrl = this.isEnterprise
      ? this.join(this.prefixWith('copilot-telemetry-service.', this.baseUrlObject).href, '/telemetry')
      : ExperimentationDotComUrl;
    this.completionsUrl = OpenAIProxyUrl;
  }

  parseUrls(url: string): { base: URL; api: URL } {
    if (
      this.env.CODESPACES === 'true' &&
      this.env.GITHUB_TOKEN &&
      this.env.GITHUB_SERVER_URL &&
      this.env.GITHUB_API_URL
    ) {
      try {
        return { base: new URL(this.env.GITHUB_SERVER_URL), api: new URL(this.env.GITHUB_API_URL) };
      } catch {}
    }
    const base = new URL(url);
    const api = this.prefixWith('api.', base);
    return { base, api };
  }

  isPermittedUrl(ctx: Context, url: string): boolean {
    return this.isValidUrl(url) && this.hasSupportedProtocol(ctx, url);
  }

  isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {}
    return false;
  }

  hasSupportedProtocol(ctx: Context, url: string): boolean {
    const proto = new URL(url).protocol;
    return proto === 'https:' || (!isProduction(ctx) && proto === 'http:');
  }

  join(url: string, path?: string): string {
    return path ? new URL(path, url).href : url;
  }

  prefixWith(prefix: string, url: URL): URL {
    return new URL(`${url.protocol}//${prefix}${url.host}`);
  }

  urlOrConfigOverride(
    ctx: Context,
    url: string,
    overrideKeys: Exclude<ConfigKeysByType<string | undefined>, undefined>[],
    testOverrideKeys?: Exclude<ConfigKeysByType<string | undefined>, undefined>[]
  ): string {
    if (testOverrideKeys && isRunningInTest(ctx)) {
      for (const overrideKey of testOverrideKeys) {
        const override = getConfig(ctx, overrideKey);
        if (override) {
          return override;
        }
      }
      return url;
    }
    for (const overrideKey of overrideKeys) {
      const override = getConfig(ctx, overrideKey);
      if (override) {
        return override;
      }
    }
    return url;
  }
}

export { DefaultNetworkConfiguration };
