import { Type, type Static } from '@sinclair/typebox';
import { type URI } from 'vscode-uri';
import { type Context } from '../context.ts';
import type { DocumentEvaluateResult, TelemetryMeasurements, TelemetryProperties } from '../types.ts';

import { minimatch } from 'minimatch';
import { factory } from 'dldr/cache';

import {
  BLOCKED_POLICY_ERROR_RESPONSE,
  NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE,
  NOT_BLOCKED_RESPONSE,
  logger,
} from './constants.ts';

import { PolicyEvaluator } from './policyEvaluator.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { Fetcher, FetchResponseError } from '../networking.ts';
import { assertShape } from '../util/typebox.ts';
import { telemetryException, telemetry, TelemetryData } from '../telemetry.ts';
import { RepositoryManager } from '../repository/repositoryManager.ts';
import { dirname, percentDecode, resolveFilePath } from '../util/uri.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { CopilotAuthError } from '../auth/error.ts';
import { DocumentUri } from 'vscode-languageserver-types';

const SourceSchema = Type.Object({ name: Type.String(), type: Type.String() });
type SourceSchema = Static<typeof SourceSchema>;

const RuleSchema = Type.Object({
  paths: Type.Array(Type.String()),
  ifNoneMatch: Type.Optional(Type.Array(Type.String())),
  ifAnyMatch: Type.Optional(Type.Array(Type.String())),
  source: SourceSchema,
});
type Rule = Static<typeof RuleSchema>;

const RulesSchema = Type.Array(RuleSchema);
type Rules = Static<typeof RulesSchema>;

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

function fileBlockedEvaluationResult(rule: Rule, reason: string): DocumentEvaluateResult {
  return {
    isBlocked: true,
    message: `Your ${rule.source.type.toLowerCase()} '${rule.source.name}' has disabled Copilot for this file`,
    reason: reason,
  };
}

const TELEMETRY_NAME = 'contentExclusion';

class CopilotContentExclusion extends PolicyEvaluator {
  private _ruleLoaderCache = new LRUCacheMap<string, Promise<Rules>>(200);
  private _evaluateResultCache = new LRUCacheMap<string, DocumentEvaluateResult>(10_000);
  private _testingRules?: Rules;

  constructor(private _context: Context) {
    super();
  }

  private async _rulesForScope(scope: string) {
    if (this._testingRules?.length) return this._testingRules;
    let rules = await this.ruleLoader(scope.toLowerCase());
    if (rules.length !== 0) return rules;
  }

  private _telemetry(event: string, properties: TelemetryProperties, measurements?: TelemetryMeasurements): void {
    telemetry(
      this._context,
      `${TELEMETRY_NAME}.${event}`,
      TelemetryData.createAndMarkAsIssued(properties, measurements)
    );
  }

  private ruleLoader = factory(async (scopes: string[]): Promise<Rules[]> => {
    const session = await this._context.get(CopilotTokenManager).getGitHubSession(this._context);
    if (!session) throw new CopilotAuthError('No token found');
    const endpoint = this._context.get(NetworkConfiguration).getContentRestrictionsUrl(session);
    const url = new URL(endpoint);
    const hasAllScope = scopes.includes('all');
    // if (scopes.filter((s) => s !== 'all').length > 0) {
    const filteredScopes = scopes.filter((s) => s !== 'all');
    if (filteredScopes.length > 0) {
      url.searchParams.set('repos', filteredScopes.join(','));
    }
    url.searchParams.set('scope', hasAllScope ? 'all' : 'repo');
    logger.debug(this._context, 'Fetching content exclusion policies', {
      params: Object.fromEntries(url.searchParams),
    });

    const result = await this._context
      .get(Fetcher)
      .fetch(url.href, { method: 'GET', headers: { Authorization: `token ${session.token}` } });
    const data = await result.json();

    if (!result.ok) {
      if (result.status === 404) return Array.from(scopes, () => []);
      logger.error(this._context, 'Failed fetching content exclusion policies', {
        params: Object.fromEntries(url.searchParams),
        data,
      });
      this._telemetry('fetch.error', { message: (data as any).message });
      throw new FetchResponseError(result);
    }

    return assertShape(ContentRestrictionsResponseSchema, data).map((r: RepoRuleSchema) => r.rules);
  }, this._ruleLoaderCache);

  async evaluate(uri: DocumentUri, fileContent: string): Promise<DocumentEvaluateResult> {
    try {
      uri = resolveFilePath(uri).toString();
      const repoInfo = await this.getGitRepo(uri);
      const rules = await this._rulesForScope((repoInfo?.url ?? 'all').toLowerCase());

      if (!rules) return NOT_BLOCKED_NO_MATCHING_POLICY_RESPONSE;

      const basePath = repoInfo?.baseFolder ?? 'file://';
      const filePathResult = await this.evaluateFilePathRules(uri, basePath, rules);
      if (filePathResult.isBlocked) return filePathResult;

      const textBasedResult = await this.evaluateTextBasedRules(uri, rules, fileContent);
      if (textBasedResult.isBlocked) return textBasedResult;
    } catch (err) {
      logger.error(this._context, err, `Error evaluating policy for <${uri}>`);
      telemetryException(this._context, err, `${TELEMETRY_NAME}.evaluate`);
      return BLOCKED_POLICY_ERROR_RESPONSE;
    }

    return NOT_BLOCKED_RESPONSE;
  }

  async evaluateFilePathRules(uri: DocumentUri, baseUri: string, rules: Rule[]): Promise<DocumentEvaluateResult> {
    let cacheKey = uri;
    if (this._evaluateResultCache.has(cacheKey)) {
      return this._evaluateResultCache.get(cacheKey)!;
    }
    let result = NOT_BLOCKED_RESPONSE;
    let fileName = percentDecode(uri.replace(baseUri, ''));
    logger.debug(this._context, '[Path Based]', `Evaluating rules for <${fileName}>`, {
      uri,
      baseUri,
      rules,
    });
    ruleLoop: for (let rule of rules) {
      logger.debug(this._context, '[Path Based]', `Evaluating rule for <${fileName}>`, {
        uri,
        baseUri,
        rule,
      });
      for (let pattern of rule.paths) {
        let matchResult = minimatch(fileName, pattern, { nocase: true, matchBase: true, nonegate: true, dot: true });
        logger.debug(this._context, '[Path Based]', `Tried to match <${fileName}> with <${pattern}>`, {
          uri,
          baseUri,
          pattern,
          result: matchResult,
        });
        if (matchResult) {
          result = fileBlockedEvaluationResult(rule, 'FILE_BLOCKED_PATH');
          break ruleLoop;
        }
      }
    }
    logger.debug(this._context, '[Path Based]', `Evaluation result for <${fileName}>`, {
      uri,
      baseUri,
      result,
    });
    this._evaluateResultCache.set(cacheKey, result);
    return result;
  }

  async evaluateTextBasedRules(uri: DocumentUri, rules: Rule[], fileContent: string): Promise<DocumentEvaluateResult> {
    let blockedIfAnyMatchRules = rules.filter((r) => r.ifAnyMatch);
    let blockedIfNoneMatchRules = rules.filter((r) => r.ifNoneMatch);
    if (!fileContent || (blockedIfAnyMatchRules.length === 0 && blockedIfNoneMatchRules.length === 0)) {
      return NOT_BLOCKED_RESPONSE;
    }
    let result = await this.evaluateFileContent(blockedIfAnyMatchRules, blockedIfNoneMatchRules, fileContent);
    logger.debug(this._context, `Evaluated text-based exclusion rules for <${uri}>`, { result });
    return result;
  }

  async evaluateFileContent(
    blockedIfAnyMatchRules: Rule[],
    blockedIfNoneMatchRules: Rule[],
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
      const existingUrls = [...this._ruleLoaderCache.keys()];
      this.reset();
      await Promise.all(existingUrls.map((url) => this.ruleLoader(url)));
    } catch (err) {
      telemetryException(this._context, err, `${TELEMETRY_NAME}.refresh`);
    }
  }

  reset(): void {
    this._ruleLoaderCache.clear();
    this._evaluateResultCache.clear();
  }

  setTestingRules(rules: Rules) {
    this._testingRules = rules;
  }

  async getGitRepo(uri: DocumentUri) {
    const repo = await this._context.get(RepositoryManager).getRepo(dirname(uri));
    if (!repo || !(repo != null && repo.remote)) return;

    const strippedUrl = repo.remote.getUrlForApi();
    if (strippedUrl) return { baseFolder: repo.baseFolder, url: strippedUrl };
  }
}

export { CopilotContentExclusion, Rule, Rules, RulesSchema };
