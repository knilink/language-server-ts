import assert from 'assert';

import { Context } from './context';
import { NetworkConfiguration } from './networkConfiguration';

import { CopilotTokenNotifier } from './auth/copilotTokenNotifier';
import { isProduction, getConfig, ConfigKey, type ConfigKeysByType } from './config';
import { NotificationSender } from './notificationSender';
import { CopilotTokenManager } from './auth/copilotTokenManager';
import { TelemetryInitialization } from './telemetry/setupTelemetryReporters';
import { isRunningInTest } from './testing/runtimeMode';
import { GitHubToken } from './auth/types';
import { CopilotToken } from './auth/copilotToken';

const DotComAuthority = 'github.com';
const DotComUrl = `https://${DotComAuthority}`;
const CAPIDotComUrl = 'https://api.githubcopilot.com';
const TelemetryDotComUrl = 'https://copilot-telemetry.githubusercontent.com/telemetry';
const OpenAIProxyUrl = 'https://copilot-proxy.githubusercontent.com';
const OriginTrackerUrl = 'https://origin-tracker.githubusercontent.com';

class DefaultNetworkConfiguration extends NetworkConfiguration {
  private isEnterprise?: boolean;
  private baseUrlObject?: URL;
  private apiUrl?: string;
  private tokenUrl?: string;
  private notificationUrl?: string;
  private contentRestrictionsUrl?: string;
  private blackbirdIndexingStatusUrl?: string;
  private loginReachabilityUrl?: string;
  private deviceFlowStartUrl?: string;
  private deviceFlowCompletionUrl?: string;
  private userInfoUrl?: string;
  private capiUrl?: string;
  private telemetryUrl?: string;
  private completionsUrl?: string;
  private originTrackerUrl?: string;

  constructor(
    ctx: Context,
    url = DotComUrl,
    readonly env = process.env
  ) {
    super();
    this.recalculateUrlDefaults(url);
    ctx.get(CopilotTokenNotifier).on('onCopilotToken', (token: CopilotToken) => this.onCopilotToken(ctx, token));
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

  getAPIReachabilityUrl(): string {
    assert(this.apiUrl);
    return this.apiUrl;
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

  getUserInfoUrl(): string {
    assert(this.userInfoUrl);
    return this.userInfoUrl;
  }

  getCAPIUrl(ctx: Context, path: string): string {
    assert(this.capiUrl);
    const url = this.urlOrConfigOverride(
      ctx,
      this.capiUrl,
      ConfigKey.DebugOverrideCapiUrl,
      ConfigKey.DebugTestOverrideCapiUrl
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

  getTelemetryUrl(): string {
    assert(this.telemetryUrl);
    return this.telemetryUrl;
  }

  setTelemetryUrlForTesting(url: string): void {
    this.telemetryUrl = url;
  }

  getCompletionsUrl(ctx: Context, path: string): string {
    assert(this.completionsUrl);
    const url = this.urlOrConfigOverride(
      ctx,
      this.completionsUrl,
      ConfigKey.DebugOverrideProxyUrl,
      ConfigKey.DebugTestOverrideProxyUrl
    );
    return this.join(url, path);
  }

  getSnippetRetrievalUrl(ctx: Context, repoNwo: string, serverRouteImpl: string): string {
    let url = new URL(this.getCompletionsUrl(ctx, 'v0/retrieval'));
    url.search = new URLSearchParams({ repo: repoNwo, impl: serverRouteImpl }).toString();
    return url.href;
  }

  getOriginTrackingUrl(ctx: Context, path: string): string {
    // EDITED
    assert(this.originTrackerUrl);
    const url = isProduction(ctx)
      ? this.originTrackerUrl
      : this.urlOrConfigOverride(ctx, this.originTrackerUrl, ConfigKey.DebugSnippyOverrideUrl);
    return this.join(url, path);
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
        ctx.get(CopilotTokenManager).resetCopilotToken(ctx);
      }
    });
  }

  updateServiceEndpoints(
    ctx: Context,
    endpoints: { api: string; proxy: string; 'origin-tracker': string; telemetry: string }
  ): void {
    if (this.isPermittedUrl(ctx, endpoints.api)) this.capiUrl = endpoints.api;
    if (this.isPermittedUrl(ctx, endpoints.proxy)) this.completionsUrl = endpoints.proxy;
    if (this.isPermittedUrl(ctx, endpoints['origin-tracker'])) this.originTrackerUrl = endpoints['origin-tracker'];
    if (this.isPermittedUrl(ctx, endpoints.telemetry)) {
      this.withTelemetryReInitialization(ctx, () => {
        this.telemetryUrl = this.join(endpoints.telemetry, 'telemetry');
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
    this.capiUrl = this.isEnterprise ? this.prefixWith('copilot-api.', this.baseUrlObject).href : CAPIDotComUrl;
    this.telemetryUrl = this.isEnterprise
      ? this.join(this.prefixWith('copilot-telemetry-service.', this.baseUrlObject).href, '/telemetry')
      : TelemetryDotComUrl;
    this.completionsUrl = OpenAIProxyUrl;
    this.originTrackerUrl = OriginTrackerUrl;
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
      } catch { }
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
    } catch { }
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

  private urlOrConfigOverride(
    ctx: Context,
    url: string,
    overrideKey: Exclude<ConfigKeysByType<string | undefined>, undefined>,
    testOverrideKey?: Exclude<ConfigKeysByType<string | undefined>, undefined>
  ): string {
    if (testOverrideKey && isRunningInTest(ctx)) {
      const testOverride = getConfig(ctx, testOverrideKey);
      // EDITED
      if (testOverride && testOverride.length) {
        return testOverride;
      }
      return url;
    }
    const override = getConfig(ctx, overrideKey);
    return override || url;
  }
}

export {
  DotComAuthority,
  DotComUrl,
  CAPIDotComUrl,
  TelemetryDotComUrl,
  OpenAIProxyUrl,
  OriginTrackerUrl,
  DefaultNetworkConfiguration,
};
