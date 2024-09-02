import { EventEmitter } from 'node:events';

import { type Context } from '../context.ts';
import { checkReachability, URLReachability } from '../reachability.ts';
import { AuthManager } from '../auth/manager.ts';
import { GitHubAppInfo } from '../config.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { CopilotTokenNotifier } from '../auth/copilotTokenNotifier.ts';

type PreconditionResult = { type: string; status: 'ok' | 'failed'; details?: URLReachability[] };

type PreconditionsResultEvent = {
  status: PreconditionResult['status'];
  results: PreconditionResult[];
};

class ReachabilityPreconditionCheck {
  async check(ctx: Context): Promise<PreconditionResult> {
    const criticalReachability: URLReachability[] = (await checkReachability(ctx)).filter(
      (r) => r.severity === 'critical'
    );
    return {
      type: 'reachability',
      status: criticalReachability.every((r) => r.status === 'reachable') ? 'ok' : 'failed',
      details: criticalReachability,
    };
  }
}
class TokenPreconditionCheck {
  async check(ctx: Context): Promise<PreconditionResult> {
    const authRecord = await ctx.get(AuthManager).getAuthRecord();
    const fallbackAppId = ctx.get(GitHubAppInfo).fallbackAppId();

    return authRecord && authRecord.githubAppId && authRecord.githubAppId !== fallbackAppId
      ? { type: 'token', status: 'ok' }
      : { type: 'token', status: 'failed' };
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
const PRECONDITION_CHECKS = [
  new ReachabilityPreconditionCheck(),
  new TokenPreconditionCheck(),
  new ChatEnabledPreconditionCheck(),
];
const preconditionsChangedEvent = 'onPreconditionsChanged';

class PreconditionsCheck {
  readonly emitter = new EventEmitter<{ [preconditionsChangedEvent]: [PreconditionsResultEvent] }>();
  private result?: { results: PreconditionResult[]; status: 'ok' | 'failed' };

  constructor(
    readonly ctx: Context,
    readonly checks = PRECONDITION_CHECKS
  ) {
    this.ctx.get(CopilotTokenNotifier).on('onCopilotToken', async () => {
      await this.check();
    });
  }

  async check(forceCheck?: boolean): Promise<{ results: PreconditionResult[]; status: 'ok' | 'failed' }> {
    if (forceCheck || !this.result) {
      const results = await Promise.all(this.checks.map((check) => check.check(this.ctx)));
      const status = results.every((p) => p.status === 'ok') ? 'ok' : 'failed';
      this.result = { results, status };
      this.emit(this.result);
    }
    return this.result!;
  }

  onChange(listener: (result: PreconditionsResultEvent) => void): void {
    this.emitter.on(preconditionsChangedEvent, listener);
  }

  emit(result: PreconditionsResultEvent): void {
    this.emitter.emit(preconditionsChangedEvent, result);
  }
}

export {
  ReachabilityPreconditionCheck,
  TokenPreconditionCheck,
  ChatEnabledPreconditionCheck,
  PRECONDITION_CHECKS,
  preconditionsChangedEvent,
  PreconditionsCheck,
  PreconditionsResultEvent,
};
