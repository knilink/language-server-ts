import * as fs from 'node:fs';

import { type CopilotTokenManager } from "../auth/copilotTokenManager.ts";

import { FakeCopilotTokenManagerFromGitHubToken, FixedCopilotTokenManager } from "./tokenManager.ts";

const tokenFileName = `${process.env.HOME}/.copilot-testing-gh-token`;
let tokenManager: CopilotTokenManager;

function getTestingCopilotTokenManager(): CopilotTokenManager {
  if (!tokenManager) {
    tokenManager = createTokenManager();
  }
  return tokenManager;
}

function readTestingGitHubToken(): string | undefined {
  if (fs.existsSync(tokenFileName)) {
    return fs.readFileSync(tokenFileName).toString();
  }
}

function createTokenManager(): CopilotTokenManager {
  const tokenStr = readTestingGitHubToken();
  if (tokenStr) {
    return new FakeCopilotTokenManagerFromGitHubToken({ token: tokenStr });
  } else if (process.env.GH_COPILOT_TOKEN) {
    return new FixedCopilotTokenManager(process.env.GH_COPILOT_TOKEN);
  } else if (process.env.GITHUB_TOKEN) {
    return new FakeCopilotTokenManagerFromGitHubToken({ token: process.env.GITHUB_TOKEN });
  } else {
    throw new Error(
      `Tests: either GH_COPILOT_TOKEN, or GITHUB_TOKEN, must be set, or there must be a GitHub token from an app with access to Copilot in ${tokenFileName}. Run "npm run get_token" to get one.`
    );
  }
}

export { getTestingCopilotTokenManager };
