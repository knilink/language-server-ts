import { Context } from "../context.ts";
import { Logger, LogLevel } from "../logger.ts";
import { execFile } from 'child_process';

const logger = new Logger(LogLevel.INFO, 'repository');

class GitConfigData {
  private data: Record<string, string[]> = {};

  getKeys(): string[] {
    return Object.keys(this.data);
  }

  getEntries(): [string, string[]][] {
    return Object.entries(this.data);
  }

  get(key: string): string | undefined {
    const entries = this.getAll(key);
    return entries ? entries[entries.length - 1] : undefined;
  }

  getAll(key: string): string[] | undefined {
    return this.data[this.normalizeKey(key)];
  }

  add(key: string, value: string): void {
    if (!(key in this.data)) {
      this.data[key] = [];
    }
    this.data[key].push(value);
  }

  getSectionValues(base: string, withKey: string): string[] {
    const prefix = `${base}.`.toLowerCase();
    const suffix = `.${withKey}`.toLowerCase();
    return Object.keys(this.data)
      .filter((key) => key.startsWith(prefix) && key.endsWith(suffix))
      .map((key) => key.slice(prefix.length, -suffix.length));
  }

  concat(other: GitConfigData): GitConfigData {
    return this.getEntries()
      .concat(other.getEntries())
      .reduce((merged, [key, values]) => {
        values.forEach((value) => merged.add(key, value));
        return merged;
      }, new GitConfigData());
  }

  normalizeKey(key: string): string {
    const parts = key.split('.');
    parts[0] = parts[0].toLowerCase();
    parts[parts.length - 1] = parts[parts.length - 1].toLowerCase();
    return parts.join('.');
  }
}

abstract class GitConfigLoader {
  abstract getConfig(ctx: Context, baseFolder: { fsPath: string }): Promise<GitConfigData | undefined>;
}

class GitCLIConfigLoader extends GitConfigLoader {
  async runCommand(cwd: string, cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { cwd }, (err: unknown, stdout: string | Buffer) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout.toString());
        }
      });
    });
  }

  async tryRunCommand(ctx: Context, cwd: string, cmd: string, args: string[]): Promise<string | undefined> {
    try {
      return await this.runCommand(cwd, cmd, args);
    } catch (err) {
      logger.info(ctx, `Failed to run command '${cmd}' in ${cwd}: ${err}`);
      return;
    }
  }

  async getConfig(ctx: Context, baseFolder: { fsPath: string }): Promise<GitConfigData | undefined> {
    const output = await this.tryRunCommand(ctx, baseFolder.fsPath, 'git', [
      'config',
      '--list',
      '--null',
      ...this.extraArgs(),
    ]);
    return output ? this.extractConfig(output) : undefined;
  }

  extractConfig(output: string): GitConfigData {
    const config = new GitConfigData();
    for (const item of output.split('\0')) {
      if (item) {
        const key = item.split('\\n', 1)[0];
        const value = item.slice(key.length + 1);
        config.add(key, value);
      }
    }
    return config;
  }

  extraArgs(): string[] {
    return [];
  }
}

class GitFallbackConfigLoader extends GitConfigLoader {
  constructor(readonly loaders: GitConfigLoader[]) {
    super();
  }

  async getConfig(ctx: Context, baseFolder: { fsPath: string }): Promise<GitConfigData | undefined> {
    for (const loader of this.loaders) {
      const config = await loader.getConfig(ctx, baseFolder);
      if (config) return config;
    }
  }
}

export { logger, GitConfigData, GitConfigLoader, GitCLIConfigLoader, GitFallbackConfigLoader };
