import { Context } from '../context.ts';
import { TelemetryData, telemetry } from '../telemetry.ts';

function telemetryAuthNotifyShown(ctx: Context, authSource: string): void {
  const data = TelemetryData.createAndMarkAsIssued({ authSource });
  return telemetry(ctx, AuthTelemetryNames.AuthNotifyShown, data);
}

function telemetryAuthNotifyDismissed(ctx: Context): void {
  return telemetry(ctx, AuthTelemetryNames.AuthNotifyDismissed);
}

function telemetryNewGitHubLogin(ctx: Context, authSource: string, authType: string): void {
  const data = TelemetryData.createAndMarkAsIssued({ authSource, authType });
  return telemetry(ctx, AuthTelemetryNames.NewGitHubLogin, data);
}

function telemetryGitHubLoginSuccess(ctx: Context, authType: string): void {
  const data = TelemetryData.createAndMarkAsIssued({ authType });
  return telemetry(ctx, AuthTelemetryNames.GitHubLoginSuccess, data);
}

const AuthTelemetryNames = {
  AuthNotifyShown: 'auth.auth_notify_shown',
  AuthNotifyDismissed: 'auth.auth_notify_dismissed',
  NewGitHubLogin: 'auth.new_github_login',
  GitHubLoginSuccess: 'auth.github_login_success',
} as const;

export { telemetryAuthNotifyShown, telemetryAuthNotifyDismissed, telemetryNewGitHubLogin, telemetryGitHubLoginSuccess };
