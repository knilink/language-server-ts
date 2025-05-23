import gitUrlParse from 'git-url-parse';

import type { RepoInfo, RepoUrlInfo } from '../types.ts';

import { Context } from '../context.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { findKnownOrg } from '../auth/orgs.ts';
import { FileSystem } from '../fileSystem.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { dirname, getFsPath, joinPath } from '../util/uri.ts';
import { DocumentUri } from 'vscode-languageserver-types';

function isRepoInfo(info: RepoInfo | 0 | undefined): info is RepoInfo {
  return info !== undefined && info !== 0;
}

async function getUserKind(ctx: Context): Promise<string> {
  const orgs = (await ctx.get(CopilotTokenManager).getToken()).organization_list ?? [];
  return findKnownOrg(orgs) ?? '';
}

async function getTokenKeyValue(ctx: Context, key: string): Promise<string> {
  return (await ctx.get(CopilotTokenManager).getToken()).getTokenValue(key) ?? '';
}

function getDogFood(repoInfo?: RepoInfo | 0): string {
  if (repoInfo === undefined || repoInfo === 0) return '';
  const ghnwo = tryGetGitHubNWO(repoInfo);
  if (ghnwo === 'github/github') return ghnwo;
  const adoNwo = tryGetADONWO(repoInfo)?.toLowerCase();
  return adoNwo ?? '';
}

function tryGetGitHubNWO(repoInfo?: RepoInfo | 0): string {
  if (repoInfo && repoInfo.hostname === 'github.com') {
    return `${repoInfo.owner}/${repoInfo.repo}`;
  }
  return '';
}

function tryGetADONWO(repoInfo?: RepoInfo): string {
  if (repoInfo && (repoInfo.hostname?.endsWith('azure.com') || repoInfo.hostname?.endsWith('visualstudio.com'))) {
    return `${repoInfo.owner}/${repoInfo.repo}`;
  }
  return '';
}

function extractRepoInfoInBackground(ctx: Context, uri: DocumentUri) {
  const baseFolder = dirname(uri);
  return backgroundRepoInfo(ctx, baseFolder);
}

const backgroundRepoInfo = computeInBackgroundAndMemoize(extractRepoInfo, 10_000);

async function extractRepoInfo(ctx: Context, uri: DocumentUri): Promise<RepoInfo | undefined> {
  if (!getFsPath(uri)) return;
  let baseUri = await getRepoBaseUri(ctx, uri.toString());
  if (!baseUri) return;

  const fs = ctx.get(FileSystem);
  const configUri = joinPath(baseUri, '.git', 'config');

  let gitConfig: string | undefined;
  try {
    gitConfig = await fs.readFileString(configUri);
  } catch (error) {
    return;
  }

  const url = getRepoUrlFromConfigText(gitConfig) || '';
  const parsedResult = parseRepoUrl(url);
  const baseFolder = getFsPath(baseUri) ?? '';

  if (!parsedResult) {
    return { baseFolder, url, hostname: '', owner: '', repo: '', pathname: '' };
  }

  return { baseFolder, url, ...parsedResult };
}

function parseRepoUrl(url: string): RepoUrlInfo | undefined {
  try {
    const parsedUrl = gitUrlParse(url);
    // @types/git-url-parse:9.0.3 outdated
    if ((parsedUrl as any).resource && parsedUrl.owner && parsedUrl.name && parsedUrl.pathname)
      return {
        hostname: (parsedUrl as any).resource,
        owner: parsedUrl.owner,
        repo: parsedUrl.name,
        pathname: parsedUrl.pathname,
      };
  } catch {}
}

async function getRepoBaseUri(ctx: Context, uri: DocumentUri): Promise<string | undefined> {
  const fs = ctx.get(FileSystem);
  let previousLength = Infinity;
  while (uri !== 'file:///' && uri.length < previousLength) {
    const configUri = joinPath(uri, '.git', 'config');
    try {
      await fs.stat(configUri);
      return uri;
    } catch {}
    previousLength = uri.length;
    uri = dirname(uri);
  }
}

function getRepoUrlFromConfigText(gitConfig: string): string | undefined {
  const remoteSectionRegex = /^\s*\[\s*remote\s+"((\\\\|\\"|[^\\"])+)"/;
  const deprecatedRemoteSectionRegex = /^\s*\[remote.([^"\s]+)/;
  const setUrlRegex = /^\s*url\s*=\s*([^\s#;]+)/;
  const newSectionRegex = /^\s*\[/;
  let remoteUrl: string | undefined;
  let remoteSection: string | undefined;
  let isWithinMultilineUrl = false;

  for (const line of gitConfig.split('\n')) {
    if (isWithinMultilineUrl && remoteUrl !== undefined) {
      remoteUrl += line;
      if (line.endsWith('\\')) {
        remoteUrl = remoteUrl.substring(0, remoteUrl.length - 1);
      } else {
        isWithinMultilineUrl = false;
        if (remoteSection === 'origin') {
          return remoteUrl;
        }
      }
    } else {
      const remoteSectionMatch = line.match(remoteSectionRegex) || line.match(deprecatedRemoteSectionRegex);
      if (remoteSectionMatch) {
        remoteSection = remoteSectionMatch[1];
      } else if (line.match(newSectionRegex)) {
        remoteSection = undefined;
      } else {
        if (remoteUrl && remoteSection !== 'origin') continue;
        const urlMatch = line.match(setUrlRegex);
        if (urlMatch) {
          remoteUrl = urlMatch[1];
          if (remoteUrl.endsWith('\\')) {
            remoteUrl = remoteUrl.substring(0, remoteUrl.length - 1);
            isWithinMultilineUrl = true;
          } else if (remoteSection === 'origin') {
            return remoteUrl;
          }
        }
      }
    }
  }
  return remoteUrl;
}

function computeInBackgroundAndMemoize<T extends unknown[], R>(
  fct: (ctx: Context, ...args: T) => Promise<R>,
  cacheSize: number
): (ctx: Context, ...args: T) => R | 0 {
  const resultsCache = new LRUCacheMap<string, CompletedComputation<R>>(cacheSize);
  const inComputation = new Set<string>();

  return (ctx, ...args) => {
    const key = JSON.stringify(args);
    const memorizedComputation = resultsCache.get(key);

    if (memorizedComputation) return memorizedComputation.result;
    if (inComputation.has(key)) return 0;

    const computation = fct(ctx, ...args);

    inComputation.add(key);
    computation.then((computedResult) => {
      resultsCache.set(key, new CompletedComputation(computedResult));
      inComputation.delete(key);
    });

    return 0;
  };
}

class CompletedComputation<T> {
  constructor(public result: T) {}
}

export {
  extractRepoInfoInBackground,
  getDogFood,
  getTokenKeyValue,
  getUserKind,
  isRepoInfo,
  parseRepoUrl,
  tryGetGitHubNWO,
};
