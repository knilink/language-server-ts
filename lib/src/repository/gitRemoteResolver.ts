import { Context } from '../context';
import { GitConfigLoader, GitConfigData } from './config';
import { GitRemoteUrl } from './gitRemoteUrl';

class GitRemoteResolver {
  public async resolveRemote(ctx: Context, baseFolder: { fsPath: string }): Promise<GitRemoteUrl | undefined> {
    const config = await ctx.get(GitConfigLoader).getConfig(ctx, baseFolder);
    if (!config) return;

    const remotes = this.getRemotes(config);
    const gitHubRemotes = remotes.filter((r) => r.url.isGitHub());

    if (gitHubRemotes.length > 0) {
      const originRemote = gitHubRemotes.find((r) => r.name === 'origin');
      return originRemote?.url ?? gitHubRemotes[0].url;
    }

    if (remotes.length > 0) {
      const originRemote = remotes.find((r) => r.name === 'origin');
      return originRemote?.url ?? remotes[0].url;
    }
  }

  private getRemotes(config: GitConfigData): { name: string; url: GitRemoteUrl }[] {
    const rules = this.getInsteadOfRules(config);
    return config
      .getSectionValues('remote', 'url')
      .map((name) => ({
        name,
        url: new GitRemoteUrl(this.applyInsteadOfRules(rules, config.get(`remote.${name}.url`) ?? '')),
      }))
      .filter((r) => r.url.isRemote());
  }

  private applyInsteadOfRules(rules: { base: string; insteadOf: string | undefined }[], toValue: string): string {
    for (const rule of rules) {
      // if (toValue.startsWith(rule.insteadOf)) {
      if (rule.insteadOf && toValue.startsWith(rule.insteadOf)) {
        return rule.base + toValue.slice(rule.insteadOf.length);
      }
    }
    return toValue;
  }

  private getInsteadOfRules(config: GitConfigData): { base: string; insteadOf: string | undefined }[] {
    return config
      .getSectionValues('url', 'insteadof')
      .map((base) => ({
        base,
        insteadOf: config.get(`url.${base}.insteadof`),
      }))
      .sort((a, b) => b.base.length - a.base.length);
  }
}

export { GitRemoteResolver };
