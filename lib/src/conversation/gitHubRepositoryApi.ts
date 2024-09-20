import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { Context } from '../context.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { Fetcher } from '../networking.ts';

type GitRepoInfo = {
  // ./extensibility/skillToReferenceAdapters.ts
  id: string;
};

class GitHubRepositoryApi {
  readonly githubRepositoryInfoCache = new Map<string, GitRepoInfo>();
  constructor(readonly ctx: Context) {
    this.ctx = ctx;
  }
  async getRepositoryInfo(owner: string, repo: string): Promise<GitRepoInfo> {
    let cachedInfo = this.githubRepositoryInfoCache.get(`${owner}/${repo}`);
    if (cachedInfo) return cachedInfo;
    let response = await this._doGetRepositoryInfo(owner, repo);
    if (response.ok) {
      let repoInfo = (await response.json()) as GitRepoInfo;
      this.githubRepositoryInfoCache.set(`${owner}/${repo}`, repoInfo);
      return repoInfo;
    }
    throw new Error(`Failed to fetch repository info for ${owner}/${repo}`);
  }
  async _doGetRepositoryInfo(owner: string, repo: string) {
    let authToken = await this.ctx.get(CopilotTokenManager).getGitHubToken(this.ctx);
    let headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    let repoUrl = this.ctx.get(NetworkConfiguration).getAPIUrl(`repos/${owner}/${repo}`);
    return this.ctx.get(Fetcher).fetch(repoUrl, { method: 'GET', headers: headers });
  }

  async isAvailable(org: string, repo: string): Promise<boolean> {
    try {
      return (await this._doGetRepositoryInfo(org, repo)).ok;
    } catch {
      return false;
    }
  }
}

export { GitHubRepositoryApi };
