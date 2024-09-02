import { URI } from 'vscode-uri';

import { TelemetryMeasurements, TelemetryProperties, TelemetryStore, DocumentEvaluateResult } from '../types.ts';
import { Context } from '../context.ts';

import { NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE, logger } from './constants.ts';
import { TextDocumentManager } from '../textDocumentManager.ts';
import { CopilotContentExclusion } from './contentExclusions.ts';
import { StatusReporter } from '../progress.ts';
import { CopilotTokenNotifier } from '../auth/copilotTokenNotifier.ts';
import { isSupportedUriScheme } from '../util/uri.ts';
import { TelemetryData, telemetry } from '../telemetry.ts';

class CopilotContentExclusionManager {
  private _featureEnabled = false;
  private _contentExclusions: CopilotContentExclusion;
  private _evaluateResultCache = new Map<string, string>();

  constructor(private ctx: Context) {
    this._contentExclusions = new CopilotContentExclusion(this.ctx);
    this.ctx.get(TextDocumentManager).onDidFocusTextDocument((e) => this.onDidChangeActiveTextEditor(e));
    this.ctx.get(CopilotTokenNotifier).on('onCopilotToken', (token) => {
      this._featureEnabled = token?.envelope?.copilotignore_enabled ?? false;
      this._evaluateResultCache.clear();
      this._contentExclusions.refresh();
    });
  }

  async onDidChangeActiveTextEditor(e: TextDocumentManager.DidFocusTextDocumentParams): Promise<void> {
    if (!this._featureEnabled || !e) return;
    const result = await this.ctx.get(TextDocumentManager).getTextDocumentWithValidation(e.document.uri);
    const isBlocked = result.status === 'invalid';
    const reason = result.status === 'invalid' ? result.reason : undefined;
    this.updateStatusIcon(isBlocked, reason);
  }

  get enabled() {
    return this._featureEnabled;
  }

  async evaluate(uri: URI, fileContent: string, shouldUpdateStatusBar?: 'UPDATE'): Promise<DocumentEvaluateResult> {
    if (!this._featureEnabled || !isSupportedUriScheme(uri.scheme)) {
      return { isBlocked: false };
    }
    const events: { key: string; result: DocumentEvaluateResult; elapsedMs: number }[] = [];
    const track = async (key: string, ev: CopilotContentExclusion): Promise<DocumentEvaluateResult> => {
      const startTimeMs = Date.now();
      const result = await ev.evaluate(uri, fileContent);
      const endTimeMs = Date.now();
      events.push({ key, result, elapsedMs: endTimeMs - startTimeMs });
      return result;
    };

    const result = (
      await Promise.all<DocumentEvaluateResult>([track('contentExclusion.evaluate', this._contentExclusions)])
    ).find((r) => r?.isBlocked) ?? { isBlocked: false };

    try {
      for (let event of events) this._trackEvaluationResult(event.key, uri, event.result, event.elapsedMs);
    } catch (e) {
      console.log('Error tracking telemetry', e);
    }
    if (shouldUpdateStatusBar === 'UPDATE') {
      this.updateStatusIcon(result.isBlocked, result.message);
    }
    return result;
  }

  updateStatusIcon(isBlocked: boolean, reason?: string): void {
    if (this._featureEnabled) {
      const statusReporter = this.ctx.get(StatusReporter);
      if (isBlocked) {
        statusReporter.setInactive(reason ?? 'Copilot is disabled');
      } else {
        statusReporter.forceNormal();
      }
    }
  }

  private _trackEvaluationResult(key: string, uri: URI, result: DocumentEvaluateResult, elapsedMs: number): boolean {
    const cacheKey = `${uri.path}${key}`;
    if (this._evaluateResultCache.get(cacheKey) === result.reason) return false;

    this._evaluateResultCache.set(cacheKey, result.reason || 'UNKNOWN');

    if (result.reason === NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE.reason) {
      logger.debug(this.ctx, `[${key}] No matching policy for this repository. uri: ${uri}`);
      return false;
    }

    const properties: TelemetryProperties = {
      isBlocked: result.isBlocked ? 'true' : 'false',
    };
    const measurements: TelemetryMeasurements = { elapsedMs: 0 };

    telemetry(this.ctx, key, TelemetryData.createAndMarkAsIssued(properties, measurements));
    telemetry(
      this.ctx,
      key,
      TelemetryData.createAndMarkAsIssued({ ...properties, path: uri.path }, measurements),
      TelemetryStore.RESTRICTED
    );

    logger.debug(this.ctx, `[${key}] ${uri}`, result);

    return true;
  }
}

export { CopilotContentExclusionManager };
