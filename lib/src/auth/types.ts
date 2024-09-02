export type TokenEnvelope = {
  user_notification: unknown;
  token: string; // ./copilotToken.ts
  error_details: Record<string, unknown>;
  expires_at: number;
  refresh_in: number;
  // ../prompt/repository.ts ['a5db0bcaae94032fe715fb34a5e4bce2', '7184f66dfcee98cb5f08a1cb936d5225', '4535c7beffc844b46bb1ed4aa04d759a']
  organization_list?: string[];
  enterprise_list: unknown;
  copilotignore_enabled: boolean;
  copilot_ide_agent_chat_gpt4_small_prompt: boolean;

  // ../defaultNetworkConfiguration.ts
  endpoints?: {
    api: string;
    proxy: string;
    'origin-tracker': string;
    telemetry: string;
  };
  // ../diagnostics.ts
  chat_enabled: boolean;
  // ../conversation/skills/projectContextSnippetProviders/BlackbirdSnippetProvider.ts
  codesearch: boolean;
};

export type CopilotAuthStatus =
  | {
      kind: 'success';
      envelope: TokenEnvelope;
    }
  | {
      kind: 'failure';
      reason: string;
      message?: string;
      code?: number;
      msg?: string;
      meta?: { [key: string]: unknown };
    };

export type GitHubToken = {
  token: string;
  // ../defaultNetworkConfiguration.ts
  devOverride?: { copilotTokenUrl?: string; notificationUrl?: string; contentRestrictionsUrl?: string };
};

export type AuthRecord = {
  user: 'codespace-user' | string;
  // ./auth/manager.ts
  oauth_token: string;
  // ../../../agent/src/notifications/github.ts
  githubAppId?: string;
  // ./manager.ts
  dev_override?: {
    copilot_token?: string;
    notification?: string;
    content_restrictions?: string;
  };
};

// ../../../agent/src/methods/signInInitiate.ts
export type AuthStatus =
  | {
      status: 'NotSignedIn';
      user?: AuthRecord['user'];
    }
  | {
      status: 'MaybeOK' | 'OK';
      user: AuthRecord['user'];
    }
  | {
      status: 'Other';
      user: AuthRecord['user'];
      reason: string;
    };
