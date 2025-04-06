import type { CopilotAuthStatus, TokenEnvelope, GitHubToken, UserNotification } from './types.ts';
import type { Context } from '../context.ts';

import { Logger } from '../logger.ts';
import { telemetry, telemetryError, TelemetryData } from '../telemetry.ts';
import { emitCopilotToken } from './copilotTokenNotifier.ts';
import { findKnownOrg } from './orgs.ts';
import { editorVersionHeaders, EditorAndPluginInfo } from '../config.ts';
import { UserErrorNotifier } from '../error/userErrorNotifier.ts';
import { NotificationSender } from '../notificationSender.ts';
import { Fetcher, Response } from '../networking.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { UrlOpener } from '../util/opener.ts';

const authLogger = new Logger('auth');
const REFRESH_BUFFER_SECONDS: number = 60;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function authFromGitHubToken(ctx: Context, githubToken: GitHubToken): Promise<CopilotAuthStatus> {
  let resultTelemetryData = TelemetryData.createAndMarkAsIssued({}, {});
  telemetry(ctx, 'auth.new_login');

  const response = await fetchCopilotToken(ctx, githubToken);
  const tokenEnvelope: TokenEnvelope = (await response.json()) as TokenEnvelope; //MARK unknown type

  const notification = tokenEnvelope.user_notification;
  notifyUser(ctx, notification, githubToken);

  if (response.clientError && !response.headers.get('x-github-request-id')) {
    authLogger.error(
      ctx,
      `HTTP ${response.status} response does not appear to originate from GitHub. Is a proxy or firewall intercepting this request? https://gh.io/copilot-firewall`
    );
  }

  if (response.status === 401) {
    const message = 'Failed to get copilot token due to 401 status. Please sign out and try again.';
    authLogger.info(ctx, message);
    telemetryError(ctx, 'auth.unknown_401', resultTelemetryData);
    return { kind: 'failure', reason: 'HTTP401', message, envelope: tokenEnvelope };
  }

  if (!response.ok || !tokenEnvelope.token) {
    authLogger.info(ctx, `Invalid copilot token: missing token: ${response.status} ${response.statusText}`);
    telemetryError(
      ctx,
      'auth.invalid_token',
      resultTelemetryData.extendedBy({ status: response.status.toString(), status_text: response.statusText })
    );

    const error_details = tokenEnvelope.error_details;

    if (error_details?.notification_id !== 'not_signed_up') {
      notifyUser(ctx, error_details, githubToken);
    }

    return {
      kind: 'failure',
      reason: 'NotAuthorized',
      message: 'User not authorized',
      envelope: tokenEnvelope,
      ...error_details,
    };
  }

  let expires_at = tokenEnvelope.expires_at;
  tokenEnvelope.expires_at = nowSeconds() + (tokenEnvelope.refresh_in ?? 0) + REFRESH_BUFFER_SECONDS;
  const copilotToken = new CopilotToken(tokenEnvelope);

  emitCopilotToken(ctx, copilotToken);
  telemetry(
    ctx,
    'auth.new_token',
    resultTelemetryData.extendedBy(
      {},
      { adjusted_expires_at: tokenEnvelope.expires_at, expires_at, current: nowSeconds() }
    )
  );

  return { kind: 'success', envelope: tokenEnvelope };
}

async function fetchCopilotToken(ctx: Context, githubToken: GitHubToken): Promise<Response> {
  const copilotTokenUrl = ctx.get(NetworkConfiguration).getTokenUrl(githubToken);
  try {
    return await ctx.get(Fetcher).fetch(copilotTokenUrl, {
      headers: { Authorization: `token ${githubToken.token}`, ...editorVersionHeaders(ctx) },
      timeout: 120_000,
    });
  } catch (err) {
    ctx.get(UserErrorNotifier).notifyUser(ctx, err);
    throw err;
  }
}

async function notifyUser(
  ctx: Context,
  notification: UserNotification | undefined,
  githubToken: GitHubToken
): Promise<void> {
  if (!notification) return;
  try {
    const response = await ctx
      .get<NotificationSender>(NotificationSender)
      .showWarningMessageOnlyOnce(
        notification.notification_id,
        notification.message,
        { title: notification.title },
        { title: 'Dismiss' }
      );
    const showUrl = response?.title === notification.title;
    const ackNotification = showUrl || response?.title === 'Dismiss';

    if (showUrl) {
      const editorInfo = ctx.get(EditorAndPluginInfo).getEditorPluginInfo();
      const urlWithContext = notification.url.replace(
        '{EDITOR}',
        encodeURIComponent(`${editorInfo.name}_${editorInfo.version}`)
      );
      await ctx.get(UrlOpener).open(urlWithContext);
    }

    if (notification.notification_id && ackNotification) {
      await sendNotificationResultToGitHub(ctx, notification.notification_id, githubToken);
    }
  } catch (error) {
    authLogger.exception(ctx, error, 'copilotToken.notification');
  }
}

async function sendNotificationResultToGitHub(ctx: Context, notificationId: string, githubToken: GitHubToken) {
  const notificationUrl = ctx.get(NetworkConfiguration).getNotificationUrl(githubToken);
  const response = await ctx.get(Fetcher).fetch(notificationUrl, {
    headers: { Authorization: `token ${githubToken.token}`, ...editorVersionHeaders(ctx) },
    method: 'POST',
    body: JSON.stringify({ notification_id: notificationId }),
  });

  if (!response || !response.ok) {
    authLogger.error(ctx, `Failed to send notification result to GitHub: ${response?.status} ${response?.statusText}`);
  }
}

class CopilotToken {
  readonly envelope: Partial<Omit<TokenEnvelope, 'token' | 'refresh_in' | 'expires_at'>> &
    Pick<TokenEnvelope, 'token' | 'refresh_in' | 'expires_at'>;
  readonly token: string;
  readonly organization_list: TokenEnvelope['organization_list'];
  readonly enterprise_list: TokenEnvelope['enterprise_list'];
  readonly tokenMap: Map<string, string>;

  constructor(
    // optional except 'token' | 'refresh_in' | 'expires_at'
    envelope: Omit<Partial<TokenEnvelope>, 'token' | 'refresh_in' | 'expires_at'> &
      Pick<TokenEnvelope, 'token' | 'refresh_in' | 'expires_at'>
  ) {
    this.envelope = envelope;
    this.token = envelope.token;
    this.organization_list = envelope.organization_list;
    this.enterprise_list = envelope.enterprise_list;
    this.tokenMap = this.parseToken(this.token);
  }

  needsRefresh() {
    return (this.envelope.expires_at - REFRESH_BUFFER_SECONDS) * 1000 < Date.now();
  }

  isExpired(): boolean {
    return this.envelope.expires_at * 1000 < Date.now();
  }

  get hasKnownOrg() {
    return findKnownOrg(this.organization_list || []) !== undefined;
  }

  parseToken(token?: string): Map<string, string> {
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

export { CopilotToken, authFromGitHubToken, authLogger };
