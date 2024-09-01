import { CopilotAuthStatus, TokenEnvelope, GitHubToken } from "./types.ts";
import { Context } from "../context.ts";
import { CopilotTokenManagerFromGitHubTokenBase } from "./copilotTokenManager.ts";

import { Logger, LogLevel } from "../logger.ts";
import { telemetry, telemetryError, TelemetryData } from "../telemetry.ts";
import { AvailableModelManager } from "../openai/model.ts";
import { editorVersionHeaders, EditorAndPluginInfo } from "../config.ts";
import { UserErrorNotifier } from "../error/userErrorNotifier.ts";
import { NotificationSender } from "../notificationSender.ts";
import { Fetcher, Response } from "../networking.ts";
import { NetworkConfiguration } from "../networkConfiguration.ts";
import { CopilotTokenNotifier } from "./copilotTokenNotifier.ts";
import { UrlOpener } from "../util/opener.ts";

const authLogger = new Logger(LogLevel.INFO, 'auth');
const REFRESH_BUFFER_SECONDS: number = 60;
let refreshRunningCount: number = 0;
const TOKEN_REFRESHED_EVENT: string = 'token_refreshed';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

type Notification = {
  notification_id?: string;
  message: string;
  title: string;
  url: string;
};

async function authFromGitHubToken(ctx: Context, githubToken: GitHubToken): Promise<CopilotAuthStatus> {
  telemetry(ctx, 'auth.new_login');

  const response = await fetchCopilotToken(ctx, githubToken);
  const tokenEnvelope: TokenEnvelope = (await response.json()) as TokenEnvelope; //MARK unknown type

  if (!tokenEnvelope) {
    authLogger.info(ctx, 'Failed to get copilot token');
    telemetryError(ctx, 'auth.request_read_failed');
    return { kind: 'failure', reason: 'FailedToGetToken' };
  }

  const notification = tokenEnvelope.user_notification;
  if (notification && response.status === 401) {
    const message = 'Failed to get copilot token due to 401 status. Please sign out and try again.';
    authLogger.info(ctx, message);
    telemetryError(ctx, 'auth.unknown_401');
    return { kind: 'failure', reason: 'HTTP401', message };
  }

  if (!response.ok || !tokenEnvelope.token) {
    authLogger.info(ctx, `Invalid copilot token: missing token: ${response.status} ${response.statusText}`);
    telemetryError(
      ctx,
      'auth.invalid_token',
      TelemetryData.createAndMarkAsIssued({
        status: response.status.toString(),
        statusText: response.statusText,
      })
    );

    const errorDetails = tokenEnvelope.error_details;
    return { kind: 'failure', reason: 'NotAuthorized', message: 'User not authorized', ...errorDetails };
  }

  let expires_at = tokenEnvelope.expires_at;
  tokenEnvelope.expires_at = nowSeconds() + (tokenEnvelope.refresh_in ?? 0) + REFRESH_BUFFER_SECONDS;
  const copilotToken = new CopilotToken(tokenEnvelope);

  ctx.get(CopilotTokenNotifier).emit('onCopilotToken', copilotToken);
  telemetry(
    ctx,
    'auth.new_token',
    TelemetryData.createAndMarkAsIssued(
      {},
      { adjusted_expires_at: tokenEnvelope.expires_at, expires_at, current: nowSeconds() }
    )
  );
  ctx.get(AvailableModelManager).logModelsForToken(ctx, copilotToken);

  return { kind: 'success', envelope: tokenEnvelope };
}

async function fetchCopilotToken(ctx: Context, githubToken: GitHubToken): Promise<Response> {
  const copilotTokenUrl = ctx.get<NetworkConfiguration>(NetworkConfiguration).getTokenUrl(githubToken);
  try {
    return await ctx.get<Fetcher>(Fetcher).fetch(copilotTokenUrl, {
      headers: { Authorization: `token ${githubToken.token}`, ...editorVersionHeaders(ctx) },
    });
  } catch (err) {
    ctx.get<UserErrorNotifier>(UserErrorNotifier).notifyUser(ctx, err);
    throw err;
  }
}

async function notifyUser(ctx: Context, notification: Notification, githubToken: GitHubToken): Promise<void> {
  if (!notification) return;
  try {
    const response = await ctx
      .get<NotificationSender>(NotificationSender)
      .showWarningMessageOnlyOnce(notification.message, { title: notification.title || '' });
    const showUrl = response?.title === notification.title;
    const ackNotification = showUrl || response?.title === 'Dismiss';

    if (showUrl) {
      const editorInfo = ctx.get<EditorAndPluginInfo>(EditorAndPluginInfo).getEditorPluginInfo();
      const urlWithContext = notification.url.replace(
        '{EDITOR}',
        encodeURIComponent(`${editorInfo.name}_${editorInfo.version}`)
      );
      await ctx.get<UrlOpener>(UrlOpener).open(urlWithContext);
    }

    if (ackNotification && notification.notification_id !== undefined) {
      await sendNotificationResultToGitHub(ctx, notification.notification_id, githubToken);
    }
  } catch (error) {
    authLogger.exception(ctx, error, 'copilotToken.notification');
  }
}

async function sendNotificationResultToGitHub(ctx: Context, notificationId: string, githubToken: GitHubToken) {
  const notificationUrl = ctx.get<NetworkConfiguration>(NetworkConfiguration).getNotificationUrl(githubToken);
  const response = await ctx.get<Fetcher>(Fetcher).fetch(notificationUrl, {
    headers: { Authorization: `token ${githubToken.token}`, ...editorVersionHeaders(ctx) },
    method: 'POST',
    body: JSON.stringify({ notification_id: notificationId }),
  });

  if (!response || !response.ok) {
    authLogger.error(ctx, `Failed to send notification result to GitHub: ${response?.status} ${response?.statusText}`);
  }
}

function refreshToken(ctx: Context, tokenManager: CopilotTokenManagerFromGitHubTokenBase, refreshIn: number): void {
  const now = nowSeconds();
  if (refreshRunningCount > 0) return;

  refreshRunningCount++;
  setTimeout(async () => {
    let kind: 'success' | 'failure';
    let error = '';
    try {
      refreshRunningCount--;
      await tokenManager.getCopilotToken(ctx, true);
      kind = 'success';
      tokenManager.tokenRefreshEventEmitter.emit(TOKEN_REFRESHED_EVENT);
    } catch (e) {
      kind = 'failure';
      error = (e as any).toString();
    }

    const data = TelemetryData.createAndMarkAsIssued(
      { result: kind },
      { time_taken: nowSeconds() - now, refresh_count: refreshRunningCount }
    );
    if (error) data.properties.reason = error;
    telemetry(ctx, 'auth.token_refresh', data);
  }, refreshIn * 1000);
}

class CopilotToken {
  readonly envelope: Partial<Omit<TokenEnvelope, 'token' | 'refresh_in' | 'expires_at'>> &
    Pick<TokenEnvelope, 'token' | 'refresh_in' | 'expires_at'>;
  readonly token: string;
  readonly organization_list: TokenEnvelope['organization_list'];
  readonly enterprise_list: TokenEnvelope['enterprise_list'];
  readonly tokenMap: Map<string, string>;

  constructor(
    envelope: Omit<Partial<TokenEnvelope>, 'token' | 'refresh_in' | 'expires_at'> &
      Pick<TokenEnvelope, 'token' | 'refresh_in' | 'expires_at'>
  ) {
    this.envelope = envelope;
    this.token = envelope.token;
    this.organization_list = envelope.organization_list;
    this.enterprise_list = envelope.enterprise_list;
    this.tokenMap = this.parseToken(this.token);
  }

  get expiresAt(): number {
    return this.envelope.expires_at;
  }

  get refreshIn(): number {
    return this.envelope.refresh_in;
  }

  isExpired(): boolean {
    return this.expiresAt * 1000 < Date.now();
  }

  // ./tokenManager.ts
  static testToken(envelope?: Partial<TokenEnvelope>): CopilotToken {
    const defaultEnvelope: Pick<TokenEnvelope, 'token' | 'refresh_in' | 'expires_at'> = {
      token: 'token',
      refresh_in: 0,
      expires_at: 0,
    };
    return new CopilotToken({ ...defaultEnvelope, ...envelope });
  }

  private parseToken(token?: string): Map<string, string> {
    const result = new Map<string, string>();
    if (token) {
      const fields = token.split(':')[0].split(';');
      for (const field of fields) {
        const [key, value] = field.split('=');
        result.set(key, value);
      }
    }
    return result;
  }

  getTokenValue(key: string): string | undefined {
    return this.tokenMap.get(key);
  }
}

export { CopilotToken, authFromGitHubToken, authLogger, refreshToken, CopilotTokenManagerFromGitHubTokenBase };
