import { GitHubToken } from './auth/types.ts';
import { type Context } from './context.ts';

export abstract class NetworkConfiguration {
  abstract getTokenUrl(githubToken: GitHubToken): string;
  abstract getCAPIUrl(ctx: Context, path?: string): string; // url
  abstract getCompletionsUrl(ctx: Context, path: string): string;
  abstract getTelemetryUrl(): string;
  abstract getNotificationUrl(githubToken: GitHubToken): string;
  abstract getLoginReachabilityUrl(): string;
  // ./conversation/gitHubRepositoryApi.ts
  abstract getAPIUrl(
    // optional ../../agent/src/methods/setEditorInfo.ts
    reponame?: string
  ): string;
  // ./auth/authPersistence.ts
  abstract getAuthAuthority(): string;
  abstract getEmbeddingsUrl(ctx: Context): string;
  abstract getBlackbirdIndexingStatusUrl(): string;
  abstract getBlackbirdCodeSearchUrl(ctx: Context): string;
  abstract getBlackbirdDocsSearchUrl(ctx: Context): string;
  abstract getDeviceFlowStartUrl(): string;
  abstract getDeviceFlowCompletionUrl(): string;
  abstract getUserInfoUrl(): string;
  abstract getOriginTrackingUrl(ctx: Context, path: string /* '/_ping' */): string;
  abstract getContentRestrictionsUrl(session: GitHubToken): string;
  // ../../agent/src/methods/setEditorInfo.ts
  abstract updateBaseUrl(ctx: Context, authUrl?: string): void;
}
