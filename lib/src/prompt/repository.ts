import path from 'node:path';
import { Utils, URI } from 'vscode-uri';
import gitUrlParse from 'git-url-parse';

import type { RepoInfo, RepoUrlInfo } from '../types.ts';

import { Context } from '../context.ts';
import { isSupportedUriScheme } from '../util/uri.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { FileSystem } from '../fileSystem.ts';
import { LRUCacheMap } from '../common/cache.ts';

function isRepoInfo(info: RepoInfo | 0 | undefined): info is RepoInfo {
  return info !== undefined && info !== 0;
}

async function getUserKind(ctx: Context): Promise<string> {
  const orgs = (await ctx.get(CopilotTokenManager).getCopilotToken(ctx, false))?.organization_list ?? [];

  return (
    ['a5db0bcaae94032fe715fb34a5e4bce2', '7184f66dfcee98cb5f08a1cb936d5225', '4535c7beffc844b46bb1ed4aa04d759a'].find(
      (org) => orgs.includes(org)
    ) || ''
  );
}

async function getFtFlag(ctx: Context): Promise<string> {
  return (await ctx.get(CopilotTokenManager).getCopilotToken(ctx, false))?.getTokenValue('ft') ?? '';
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

function extractRepoInfoInBackground(ctx: Context, uri: URI) {
  const baseFolder = Utils.dirname(uri);
  return backgroundRepoInfo(ctx, baseFolder);
}

const backgroundRepoInfo = computeInBackgroundAndMemoize(extractRepoInfo, 10_000);

async function extractRepoInfo(ctx: Context, uri: URI): Promise<RepoInfo | undefined> {
  if (!isSupportedUriScheme(uri.scheme)) return;

  let baseFolder = await getRepoBaseFolder(ctx, uri.fsPath);
  if (!baseFolder) return;

  const fs = ctx.get(FileSystem);
  const configPath = path.join(baseFolder, '.git', 'config');

  let gitConfig: string | undefined;
  try {
    gitConfig = await fs.readFileString(URI.file(configPath));
  } catch (error) {
    return;
  }

  const url = getRepoUrlFromConfigText(gitConfig) || '';
  const parsedResult = parseRepoUrl(url);

  if (!parsedResult) {
    return { baseFolder, url, hostname: '', owner: '', repo: '', pathname: '' };
  }

  return { baseFolder, url, ...parsedResult };
}

function parseRepoUrl(url: string): RepoUrlInfo | undefined {
  try {
    const parsedUrl = gitUrlParse(url);
    // @types/git-url-parse:9.0.3 outdated
    if ((parsedUrl as any).host && parsedUrl.owner && parsedUrl.name && parsedUrl.pathname)
      return {
        hostname: (parsedUrl as any).host,
        owner: parsedUrl.owner,
        repo: parsedUrl.name,
        pathname: parsedUrl.pathname,
      };
  } catch {}
}

async function getRepoBaseFolder(ctx: Context, uri: string): Promise<string | undefined> {
  const fs = ctx.get<FileSystem>(FileSystem);
  let previousLength = Infinity;
  while (uri.length > 1 && uri.length < previousLength) {
    const configPath = path.join(uri, '.git', 'config');
    try {
      await fs.stat(URI.file(configPath));
      return uri;
    } catch {}
    previousLength = uri.length;
    uri = path.dirname(uri);
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
  getFtFlag,
  isRepoInfo,
  CompletedComputation,
  extractRepoInfoInBackground,
  tryGetGitHubNWO,
  getDogFood,
  getUserKind,
  RepoInfo,
  parseRepoUrl,
};
