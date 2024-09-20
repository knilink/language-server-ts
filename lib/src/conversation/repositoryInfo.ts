import { URI } from 'vscode-uri';
import { conversationLogger } from './logger.ts';
import { CurrentEditorSkillId } from './skills/CurrentEditorSkill.ts';
import { GitMetadataSkillId } from './skills/GitMetadataSkill.ts';
import { extractRepoInfoInBackground, isRepoInfo, parseRepoUrl } from '../prompt/repository.ts';
import { TurnContext } from './turnContext.ts';
import { RepoInfo } from '../types.ts';

async function extractRepoInfo(turnContext: TurnContext): Promise<
  | {
      repoInfo: RepoInfo;
      skillUsed: typeof GitMetadataSkillId | typeof CurrentEditorSkillId;
    }
  | undefined
> {
  let currentEditorSkillResolution = await turnContext.skillResolver.resolve(CurrentEditorSkillId);
  if (currentEditorSkillResolution) {
    let currentFolderUri = currentEditorSkillResolution.uri;
    let repoInfo = extractRepoInfoInBackground(turnContext.ctx, currentFolderUri);
    if (isRepoInfo(repoInfo)) return { repoInfo: repoInfo, skillUsed: CurrentEditorSkillId };
  }
  let gitMetadataSkillResolution = await turnContext.skillResolver.resolve(GitMetadataSkillId);
  if (
    !gitMetadataSkillResolution ||
    !gitMetadataSkillResolution.remotes ||
    gitMetadataSkillResolution.remotes.length === 0
  ) {
    conversationLogger.debug(turnContext.ctx, 'Git metadata skill is not available or no remotes available.');
    return;
  }
  let originRemote = gitMetadataSkillResolution.remotes.find((r) => r.name === 'origin');
  let remote = originRemote != null ? originRemote : gitMetadataSkillResolution.remotes[0];
  let parsedInfo = parseRepoUrl(remote.url);
  if (parsedInfo)
    return {
      repoInfo: { baseFolder: URI.parse(gitMetadataSkillResolution.path).fsPath, url: remote.url, ...parsedInfo },
      skillUsed: GitMetadataSkillId,
    };
}

export { extractRepoInfo };
