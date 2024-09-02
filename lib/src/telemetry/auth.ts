import { Context } from '../context.ts';
import { TelemetryData, telemetry, telemetryError } from '../telemetry.ts';

async function telemetryAuthNotifyShown(ctx: Context, authSource: string): Promise<void> {
  const data = TelemetryData.createAndMarkAsIssued({ authSource });
  await telemetry(ctx, 'auth.auth_notify_shown', data);
}

async function telemetryAuthNotifyDismissed(ctx: Context): Promise<void> {
  await telemetry(ctx, 'auth.auth_notify_dismissed');
}

async function telemetryNewGitHubLogin(ctx: Context, authSource: string, authType: string): Promise<void> {
  const data = TelemetryData.createAndMarkAsIssued({ authSource, authType });
  await telemetry(ctx, 'auth.new_github_login', data);
}

async function telemetryGitHubLoginSuccess(ctx: Context, authType: string): Promise<void> {
  const data = TelemetryData.createAndMarkAsIssued({ authType });
  await telemetry(ctx, 'auth.github_login_success', data);
}

async function telemetryGitHubLoginFailed(ctx: Context): Promise<void> {
  await telemetryError(ctx, 'auth.github_login_failed');
}

export {
  telemetryAuthNotifyShown,
  telemetryAuthNotifyDismissed,
  telemetryNewGitHubLogin,
  telemetryGitHubLoginSuccess,
  telemetryGitHubLoginFailed,
};
