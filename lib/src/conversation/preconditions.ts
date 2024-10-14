import { EventEmitter } from 'node:events';

import { type Context } from '../context.ts';
import { URLReachability } from '../reachability.ts';
import { AuthManager } from '../auth/manager.ts';
import { GitHubAppInfo } from '../config.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { CopilotTokenNotifier } from '../auth/copilotTokenNotifier.ts';
import { Features } from '../experiments/features.ts';

type PreconditionResult = { type: string; status: 'ok' | 'failed'; details?: URLReachability[]; githubAppId?: string };

type PreconditionsResultEvent = {
  status: PreconditionResult['status'];
  results: PreconditionResult[];
};

class TokenPreconditionCheck {
  async check(ctx: Context): Promise<PreconditionResult> {
    const authRecord = await ctx.get(AuthManager).getAuthRecord();
    const appInfo = ctx.get(GitHubAppInfo);
    const fallbackAppId = appInfo.fallbackAppId();

    return authRecord && authRecord.githubAppId && authRecord.githubAppId !== fallbackAppId
      ? { type: 'token', status: 'ok' }
      : { type: 'token', status: 'failed', githubAppId: appInfo.experimentalJetBrainsAppId() };
  }
}
class ChatEnabledPreconditionCheck {
  async check(ctx: Context): Promise<PreconditionResult> {
    const copilotToken = await ctx.get(CopilotTokenManager).getCopilotToken(ctx);
    return {
      type: 'chat_enabled',
      status: copilotToken.envelope.chat_enabled ? 'ok' : 'failed',
    };
  }
}
const PRECONDITION_CHECKS = [new TokenPreconditionCheck(), new ChatEnabledPreconditionCheck()];
const preconditionsChangedEvent = 'onPreconditionsChanged';

class PreconditionsCheck {
  readonly emitter = new EventEmitter<{ [preconditionsChangedEvent]: [PreconditionsResultEvent] }>();
  private result?: Promise<{ results: PreconditionResult[]; status: 'ok' | 'failed' }>;

  constructor(
    readonly ctx: Context,
    readonly checks = PRECONDITION_CHECKS
  ) {
    this.ctx.get(CopilotTokenNotifier).on('onCopilotToken', async () => {
      await this.check();
    });
  }

  check(forceCheck?: boolean): Promise<{ results: PreconditionResult[]; status: 'ok' | 'failed' }> {
    if (forceCheck) {
      this.result = undefined;
    }

    if (this.result === undefined) {
      this.result = this.requestChecks();
    }

    return this.result;
  }

  async requestChecks() {
    let results: PreconditionResult[] = [];
    if (this.checks.length > 0) {
      const features = this.ctx.get(Features);
      const telemetryDataWithExp = await features.updateExPValuesAndAssignments();
      const extensibilityEnabled = features.ideChatEnableExtensibilityPlatform(telemetryDataWithExp);
      results = await Promise.all(
        this.checks
          .filter((c) => (c instanceof TokenPreconditionCheck ? extensibilityEnabled : true))
          .map((check) => check.check(this.ctx))
      );
    }
    const status: 'ok' | 'failed' = results.every((p) => p.status === 'ok') ? 'ok' : 'failed';
    const result = { results: results, status: status };
    this.emit(result);
    return result;
  }

  onChange(listener: (result: PreconditionsResultEvent) => void): void {
    this.emitter.on(preconditionsChangedEvent, listener);
  }

  emit(result: PreconditionsResultEvent): void {
    this.emitter.emit(preconditionsChangedEvent, result);
  }
}

export {
  TokenPreconditionCheck,
  ChatEnabledPreconditionCheck,
  PRECONDITION_CHECKS,
  preconditionsChangedEvent,
  PreconditionsCheck,
  PreconditionsResultEvent,
};
