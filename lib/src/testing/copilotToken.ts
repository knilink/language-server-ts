import type { Context } from '../context.ts';

import * as fs from 'node:fs';
import { createLibTestingContext } from './context.ts';
import { FixedCopilotTokenManager } from './tokenManager.ts';
import { CopilotTokenManager } from '../auth/copilotTokenManager.ts';
import { CopilotToken, authFromGitHubToken } from '../auth/copilotToken.ts';
import { CopilotAuthError } from '../auth/error.ts';
import { HelixFetcher } from '../network/helix.ts';
import { Fetcher } from '../networking.ts';
import { v4 as uuidv4 } from 'uuid';

async function setTestingCopilotTokenManager(ctx: Context) {
  ctx.forceSet(CopilotTokenManager, new FixedCopilotTokenManager(await getCopilotToken()));
}

let githubToken: string;

async function getTestingGitHubToken(): Promise<string> {
  try {
    if (!githubToken) {
      githubToken = (await fs.promises.readFile(tokenFileName)).toString().trim();
    }
  } catch {
    if (!(githubToken != null)) {
      githubToken = process.env.GITHUB_TOKEN ?? '';
    }
  }
  if (!githubToken) {
    throw new Error(
      `Tests: either GH_COPILOT_IDE_TOKEN, GH_COPILOT_TOKEN, or GITHUB_TOKEN must be set, or there must be a GitHub token from an app with access to Copilot in ${tokenFileName}. Run "npm run get_token" to get one.`
    );
  }
  return githubToken;
}

function createTestCopilotToken(envelope: Partial<CopilotToken['envelope']>) {
  return new CopilotToken({ token: `test token ${uuidv4()}`, refresh_in: 0, expires_at: 0, ...envelope });
}

let tokenFileName = `${process.env.HOME}/.copilot-testing-gh-token`;
let copilotToken: Promise<string>;

const getCopilotToken = async (): Promise<string> => {
  if (process.env.GH_COPILOT_IDE_TOKEN) {
    return process.env.GH_COPILOT_IDE_TOKEN;
  }
  const ghCopilotToken = process.env.GH_COPILOT_TOKEN ?? '';
  if (/=/.test(ghCopilotToken)) {
    return ghCopilotToken;
  }
  if (copilotToken) {
    return copilotToken;
  }
  const githubToken = ghCopilotToken || process.env.GITHUB_COPILOT_TOKEN || (await getTestingGitHubToken());
  const ctx = createLibTestingContext();
  const fetcher = new HelixFetcher(ctx);
  ctx.forceSet(Fetcher, fetcher);

  copilotToken = authFromGitHubToken(ctx, { token: githubToken }).then((ctr) => {
    if (ctr.kind === 'success') {
      return ctr.envelope.token;
    }
    throw new CopilotAuthError('Could not fetch testing Copilot token. Try running "npm run get_token" again?');
  });

  return copilotToken;
};

export { createTestCopilotToken, setTestingCopilotTokenManager };
