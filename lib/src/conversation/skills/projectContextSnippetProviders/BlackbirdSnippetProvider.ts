import * as path from 'node:path';
import { URI } from 'vscode-uri';
import { Range } from 'vscode-languageserver-types';

// import { Snippet } from '../../../../../prompt/src/types';
import { type TurnContext } from '../../turnContext.ts';

import { CopilotTokenManager } from '../../../auth/copilotTokenManager.ts';
import { ProjectLabelsSkillId, ProjectLabelsType } from '../ProjectLabelsSkill.ts';
import { BlackbirdIndexingStatus } from './indexingStatus.ts';
import {
  tryGetGitHubNWO,
  extractRepoInfoInBackground,
  isRepoInfo,
  parseRepoUrl,
  RepoInfo,
} from '../../../prompt/repository.ts';
import { conversationLogger } from '../../logger.ts';
import { NetworkConfiguration } from '../../../networkConfiguration.ts';
import { postRequest, type Response } from '../../../networking.ts';
import { CurrentEditorSkillId } from '../CurrentEditorSkill.ts';
import { GitMetadataSkillId } from '../GitMetadataSkill.ts';
import assert from 'node:assert';
import { Snippet } from '../../../types.ts';

class BlackbirdSnippetProvider implements Snippet.ISnippetProvider {
  async canProvideSnippets(turnContext: TurnContext): Promise<boolean> {
    const copilotTokenManager = turnContext.ctx.get(CopilotTokenManager);
    const copilotToken = await copilotTokenManager.getCopilotToken(turnContext.ctx);
    const githubToken = await copilotTokenManager.getGitHubToken(turnContext.ctx);

    return !copilotToken.envelope.codesearch || !githubToken
      ? false
      : await this.checkIndexingStatus(turnContext, githubToken);
  }

  async provideSnippets(turnContext: TurnContext): Promise<Snippet.Snippet[]> {
    const projectLabels = await turnContext.skillResolver.resolve(ProjectLabelsSkillId);
    const repoNWO = await this.getRepoInfo(turnContext);
    assert(projectLabels); // MARK fuck
    return await this.searchBlackbird(repoNWO, projectLabels, turnContext);
  }

  async checkIndexingStatus(turnContext: TurnContext, token: string): Promise<boolean> {
    const repoInfoResult = await this.extractRepoInfo(turnContext);
    if (!repoInfoResult) return false;

    return await turnContext.ctx
      .get(BlackbirdIndexingStatus)
      .isRepoIndexed(turnContext, repoInfoResult.repoInfo, token);
  }

  async getRepoInfo(turnContext: TurnContext): Promise<string | undefined> {
    const result = await this.extractRepoInfo(turnContext);
    if (!result) return;

    const { repoInfo, skillUsed } = result;
    const repoNWO = tryGetGitHubNWO(repoInfo);
    conversationLogger.debug(
      turnContext.ctx,
      `Blackbird search repo information: ${repoNWO} - Skill used: ${skillUsed}`
    );
    return repoNWO;
  }

  async searchBlackbird(
    repoNWO: string | undefined,
    projectLabels: ProjectLabelsType,
    turnContext: TurnContext
  ): Promise<Snippet.Snippet[]> {
    await turnContext.steps.start('retrieve-snippets', 'Retrieving snippets');
    const userQuery = [turnContext.turn.request.message];
    const ctx = turnContext.ctx;
    const codeSearchUrl = ctx.get(NetworkConfiguration).getBlackbirdCodeSearchUrl(ctx);
    const codeSnippets = await this.searchSingleBlackbirdEndpoint(
      repoNWO,
      projectLabels,
      false,
      userQuery,
      codeSearchUrl,
      turnContext
    );
    const docsSearchUrl = ctx.get(NetworkConfiguration).getBlackbirdDocsSearchUrl(ctx);
    const docsSnippets = await this.searchSingleBlackbirdEndpoint(
      repoNWO,
      projectLabels,
      true,
      userQuery,
      docsSearchUrl,
      turnContext
    );

    await turnContext.steps.finish('retrieve-snippets');
    return [...codeSnippets, ...docsSnippets];
  }

  async searchSingleBlackbirdEndpoint(
    repoNWO: string | undefined,
    projectLabels: ProjectLabelsType,
    searchTopics: boolean,
    userQuery: string[],
    endpoint: string,
    turnContext: TurnContext
  ): Promise<Snippet.Snippet[]> {
    const searchScope = await this.buildScopingQuery(repoNWO, projectLabels, searchTopics, turnContext);
    if (searchScope) {
      const response = await this.executeBlackbirdRequest(userQuery, searchScope, endpoint, turnContext);
      return await this.processBlackbirdResponse(turnContext, response);
    }
    return [];
  }

  async buildScopingQuery(
    repoNWO: string | undefined,
    projectLabels: ProjectLabelsType,
    searchTopics: boolean,
    turnContext: TurnContext
  ): Promise<string[] | undefined> {
    const searchScope: string[] = [];
    let topicsToSearch = '';
    let reposToSearch = '';

    if (repoNWO === undefined && !searchTopics) {
      conversationLogger.error(turnContext.ctx, 'Scoping Query: No repo to search and searching topics is turned off');
      return;
    } else if (repoNWO !== undefined) {
      reposToSearch += `repo:${repoNWO}`;
    }

    const { labels } = projectLabels;
    if (labels.length > 0 && searchTopics) {
      topicsToSearch += `topic:${labels[0]}`;
    }
    if (labels.length > 1) {
      for (let i = 1; i < labels.length; i++) {
        topicsToSearch += ` OR topic:${labels[i]}`;
      }
    }

    if (reposToSearch.length > 0 && topicsToSearch.length > 0) {
      searchScope[0] = `${reposToSearch} OR ${topicsToSearch}`;
    } else if (reposToSearch.length > 0) {
      searchScope[0] = reposToSearch;
    } else if (topicsToSearch.length > 0) {
      searchScope[0] = topicsToSearch;
    } else {
      conversationLogger.error(turnContext.ctx, 'Scoping Query: No repo or topics to search');
      return;
    }
    return searchScope;
  }

  async executeBlackbirdRequest(
    userQuery: string[],
    scopingQuery: string[],
    endpoint: string,
    turnContext: TurnContext
  ): Promise<Response> {
    const blackbirdToken = await this.getOAuthToken(turnContext);
    if (blackbirdToken === undefined) {
      conversationLogger.error(turnContext.ctx, 'Failed to send request to Blackbird due to missing token');
      throw new Error('Failed to send request to Blackbird due to missing token');
    }

    return postRequest(
      turnContext.ctx,
      endpoint,
      blackbirdToken,
      undefined,
      turnContext.turn.id,
      { query: userQuery[0], scopingQuery: scopingQuery[0] },
      turnContext.cancelationToken
    );
  }

  async getOAuthToken(turnContext: TurnContext): Promise<string | undefined> {
    return await turnContext.ctx.get(CopilotTokenManager).getGitHubToken(turnContext.ctx);
  }

  async processBlackbirdResponse(turnContext: TurnContext, response: Response): Promise<Snippet.Snippet[]> {
    let searchSnippets: Snippet.Snippet[] = [];
    if (response.ok) {
      const fullResponse: any = await response.json();
      if (fullResponse.results) {
        const result = await this.extractRepoInfo(turnContext);
        searchSnippets = fullResponse.results.map((snippet: any): Snippet.Snippet => {
          const lines = snippet.contents.split('\n');
          const range = {
            start: { line: snippet.range.start, character: 0 },
            end: { line: snippet.range.end, character: lines[lines.length - 1].length },
          };
          return {
            path: path.join(result?.repoInfo?.baseFolder ?? '', snippet.path),
            snippet: snippet.contents,
            range: range,
          };
        });
      }
    } else {
      conversationLogger.error(
        turnContext.ctx,
        `Error searching blackbird, response status code: ${response.status} - response: ${await response.text()}`
      );
    }
    return searchSnippets;
  }

  async extractRepoInfo(
    turnContext: TurnContext
  ): Promise<{ repoInfo: RepoInfo; skillUsed: typeof GitMetadataSkillId | typeof CurrentEditorSkillId } | undefined> {
    const currentEditorSkillResolution = await turnContext.skillResolver.resolve(CurrentEditorSkillId);
    if (currentEditorSkillResolution) {
      const currentFolderUri = URI.file(currentEditorSkillResolution.uri);
      const repoInfo = extractRepoInfoInBackground(turnContext.ctx, currentFolderUri);
      if (isRepoInfo(repoInfo)) return { repoInfo: repoInfo, skillUsed: CurrentEditorSkillId };
    }

    const gitMetadataSkillResolution = await turnContext.skillResolver.resolve(GitMetadataSkillId);
    if (
      !gitMetadataSkillResolution ||
      !gitMetadataSkillResolution.remotes ||
      gitMetadataSkillResolution.remotes.length === 0
    ) {
      conversationLogger.debug(turnContext.ctx, 'Git metadata skill is not available or no remotes available.');
      return;
    }

    const originRemote = gitMetadataSkillResolution.remotes.find((r) => r.name === 'origin');
    const remote = originRemote ?? gitMetadataSkillResolution.remotes[0];
    const parsedInfo = parseRepoUrl(remote.url);
    if (parsedInfo) {
      return {
        repoInfo: {
          baseFolder: URI.parse(gitMetadataSkillResolution.path).fsPath,
          url: remote.url,
          ...parsedInfo,
        },
        skillUsed: GitMetadataSkillId,
      };
    }
  }
}

export { BlackbirdSnippetProvider };
