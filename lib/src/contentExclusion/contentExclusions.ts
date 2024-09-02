import { Type, type Static } from '@sinclair/typebox';
import { type URI } from 'vscode-uri';
import { type Context } from '../context.ts';
import type { DocumentEvaluateResult, TelemetryMeasurements, TelemetryProperties } from '../types.ts';

import { minimatch } from 'minimatch';
import { factory } from 'dldr/cache';

import {
  NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE,
  NOT_BLOCKED_RESPONSE,
  BLOCKED_POLICY_ERROR_RESPONSE,
} from './constants.ts';

import { PolicyEvaluator } from './policyEvaluator.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { Fetcher, FetchResponseError } from '../networking.ts';
import { assertShape } from '../util/typebox.ts';
import { telemetryException, telemetry, TelemetryData } from '../telemetry.ts';
import { RepositoryManager } from '../repository/repositoryManager.ts';
import { dirname } from '../util/uri.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { CopilotAuthError } from '../auth/error.ts';

const SourceSchema = Type.Object({ name: Type.String(), type: Type.String() });
type SourceSchema = Static<typeof SourceSchema>;

const RuleSchema = Type.Object({
  paths: Type.Array(Type.String()),
  ifNoneMatch: Type.Optional(Type.Array(Type.String())),
  ifAnyMatch: Type.Optional(Type.Array(Type.String())),
  source: SourceSchema,
});
type RuleSchema = Static<typeof RuleSchema>;

const RulesSchema = Type.Array(RuleSchema);
type RulesSchema = Static<typeof RulesSchema>;

const RepoRuleSchema = Type.Object({
  rules: RulesSchema,
  last_updated_at: Type.String(),
  scope: Type.String(),
});
type RepoRuleSchema = Static<typeof RepoRuleSchema>;

const ContentRestrictionsResponseSchema = Type.Array(RepoRuleSchema);
type ContentRestrictionsResponseSchema = Static<typeof ContentRestrictionsResponseSchema>;

function stringToRegex(str: string): RegExp {
  if (!str.startsWith('/') && !str.endsWith('/')) return new RegExp(str);
  const pattern = str.slice(1, str.lastIndexOf('/'));
  const flags = str.slice(str.lastIndexOf('/') + 1);
  return new RegExp(pattern, flags);
}

function fileBlockedEvaluationResult(rule: RuleSchema, reason: string): DocumentEvaluateResult {
  return {
    isBlocked: true,
    message: `Your ${rule.source.type.toLowerCase()} '${rule.source.name}' has disabled Copilot for this file`,
    reason: reason,
  };
}

const TELEMETRY_NAME = 'contentExclusion';

class CopilotContentExclusion extends PolicyEvaluator {
  private evaluateResultCache = new LRUCacheMap<string, DocumentEvaluateResult>(10_000);

  private ruleLoaderCache = new LRUCacheMap<string, Promise<RulesSchema>>(200);

  constructor(private context: Context) {
    super();
  }

  private async rulesForScope(scope: string) {
    let rules = await this.ruleLoader(scope.toLowerCase());
    if (rules.length !== 0) return rules;
  }

  private telemetry(event: string, properties: TelemetryProperties, measurements?: TelemetryMeasurements): void {
    telemetry(
      this.context,
      `${TELEMETRY_NAME}.${event}`,
      TelemetryData.createAndMarkAsIssued(properties, measurements)
    );
  }

  private ruleLoader = factory(async (scopes: string[]): Promise<RulesSchema[]> => {
    const session = await this.context.get(CopilotTokenManager).getGitHubSession(this.context);
    if (!session) throw new CopilotAuthError('No token found');
    const endpoint = this.context.get(NetworkConfiguration).getContentRestrictionsUrl(session);
    const url = new URL(endpoint);
    const hasAllScope = scopes.includes('all');
    // if (scopes.filter((s) => s !== 'all').length > 0) {
    const filteredScopes = scopes.filter((s) => s !== 'all');
    if (filteredScopes.length > 0) {
      url.searchParams.set('repos', filteredScopes.join(','));
    }
    url.searchParams.set('scope', hasAllScope ? 'all' : 'repo');

    const result = await this.context
      .get(Fetcher)
      .fetch(url.href, { method: 'GET', headers: { Authorization: `token ${session.token}` } });
    const data = await result.json();

    if (!result.ok) {
      if (result.status === 404) return Array.from(scopes, () => []);
      this.telemetry('fetch.error', { message: (data as any).message });
      throw new FetchResponseError(result);
    }

    return assertShape(ContentRestrictionsResponseSchema, data).map((r: RepoRuleSchema) => r.rules);
  }, this.ruleLoaderCache);

  async evaluate(uri: URI, fileContent: string): Promise<DocumentEvaluateResult> {
    try {
      const repoInfo = await this.getGitRepo(uri);
      const rules = await this.rulesForScope((repoInfo?.url ?? 'all').toLowerCase());

      if (!rules) return NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE;

      const basePath = repoInfo?.baseFolder?.path ?? '';
      const filePathResult = await this.evaluateFilePathRules(uri, basePath, rules);
      if (filePathResult.isBlocked) return filePathResult;

      const textBasedResult = await this.evaluateTextBasedRules(rules, fileContent);
      if (textBasedResult.isBlocked) return textBasedResult;
    } catch (err) {
      telemetryException(this.context, err, `${TELEMETRY_NAME}.evaluate`);
      return BLOCKED_POLICY_ERROR_RESPONSE;
    }

    return NOT_BLOCKED_RESPONSE;
  }

  async evaluateFilePathRules(uri: URI, basePath: string, rules: RuleSchema[]): Promise<DocumentEvaluateResult> {
    const cacheKey = uri.fsPath;
    if (this.evaluateResultCache.has(cacheKey)) return this.evaluateResultCache.get(cacheKey)!;

    let result = NOT_BLOCKED_RESPONSE;
    const fileName = uri.path.replace(basePath, '');

    ruleLoop: for (const rule of rules) {
      for (const pattern of rule.paths) {
        if (minimatch(fileName, pattern, { nocase: true, matchBase: true, nonegate: true, dot: true })) {
          result = fileBlockedEvaluationResult(rule, 'FILE_BLOCKED_PATH');
          break ruleLoop;
        }
      }
    }

    this.evaluateResultCache.set(cacheKey, result);
    return result;
  }

  async evaluateTextBasedRules(rules: RuleSchema[], fileContent: string): Promise<DocumentEvaluateResult> {
    const blockedIfAnyMatchRules = rules.filter((r) => r.ifAnyMatch);
    const blockedIfNoneMatchRules = rules.filter((r) => r.ifNoneMatch);

    if (!fileContent || (blockedIfAnyMatchRules.length === 0 && blockedIfNoneMatchRules.length === 0)) {
      return NOT_BLOCKED_RESPONSE;
    }

    return this.evaluateFileContent(blockedIfAnyMatchRules, blockedIfNoneMatchRules, fileContent);
  }

  async evaluateFileContent(
    blockedIfAnyMatchRules: RuleSchema[],
    blockedIfNoneMatchRules: RuleSchema[],
    fileContent: string
  ): Promise<{ isBlocked: boolean; message?: string; reason?: string }> {
    for (const rule of blockedIfAnyMatchRules) {
      if (
        rule.ifAnyMatch &&
        rule.ifAnyMatch.length > 0 &&
        rule.ifAnyMatch.map(stringToRegex).some((r) => r.test(fileContent))
      ) {
        return fileBlockedEvaluationResult(rule, 'FILE_BLOCKED_TEXT_BASED');
      }
    }

    for (const rule of blockedIfNoneMatchRules) {
      if (
        rule.ifNoneMatch &&
        rule.ifNoneMatch.length > 0 &&
        !rule.ifNoneMatch.map(stringToRegex).some((r) => r.test(fileContent))
      ) {
        return fileBlockedEvaluationResult(rule, 'FILE_BLOCKED_TEXT_BASED');
      }
    }

    return NOT_BLOCKED_RESPONSE;
  }

  async refresh(): Promise<void> {
    try {
      const existingUrls = [...this.ruleLoaderCache.keys()];
      this.reset();
      await Promise.all(existingUrls.map((url) => this.ruleLoader(url)));
    } catch (err) {
      telemetryException(this.context, err, `${TELEMETRY_NAME}.refresh`);
    }
  }

  reset(): void {
    this.ruleLoaderCache.clear();
    this.evaluateResultCache.clear();
  }

  async getGitRepo(uri: URI) {
    const repo = await this.context.get(RepositoryManager).getRepo(dirname(uri));
    if (!repo || !(repo != null && repo.remote)) return;

    const strippedUrl = repo.remote.getUrlForApi();
    if (strippedUrl) return { baseFolder: repo.baseFolder, url: strippedUrl };
  }
}

export { CopilotContentExclusion };
