import type { AuthRecord } from './auth/types.ts';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';

function getXdgConfigPath() {
  return process.env.XDG_CONFIG_HOME && path.isAbsolute(process.env.XDG_CONFIG_HOME)
    ? process.env.XDG_CONFIG_HOME + '/github-copilot'
    : os.platform() === 'win32'
      ? process.env.USERPROFILE + '\\AppData\\Local\\github-copilot'
      : process.env.HOME + '/.config/github-copilot';
}

function makeXdgPersistenceManager(): PersistenceManager {
  return new FilePersistenceManager(getXdgConfigPath());
}

abstract class PersistenceManager {
  abstract directory: string;
  abstract read(setting: string, key: string): Promise<unknown>;
  abstract update(setting: string, key: string, value: unknown): Promise<void>;
  abstract delete(setting: string, key: string): Promise<void>;
  abstract deleteSetting(setting: string): Promise<void>;
  abstract listSettings(): Promise<string[]>;
  abstract listKeys(setting: string): Promise<string[]>;
}

class FilePersistenceManager extends PersistenceManager {
  constructor(readonly directory: string) {
    super();
  }

  async read(setting: string, key: string): Promise<unknown> {
    try {
      return (await this.readJsonObject(setting))[key];
    } catch (error) {}
  }

  async update(setting: string, key: string, value: unknown): Promise<void> {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const configFile = `${this.directory}/${setting}.json`;
    const contentsJSON = await this.readJsonObject(setting);
    contentsJSON[key] = value;
    await fs.promises.writeFile(configFile, `${JSON.stringify(contentsJSON)}\n`, { encoding: 'utf8' });
  }

  async delete(setting: string, key: string): Promise<void> {
    const configFile = `${this.directory}/${setting}.json`;
    try {
      const contentsJSON = await this.readJsonObject(setting);
      delete contentsJSON[key];
      const contentsOut = `${JSON.stringify(contentsJSON)}\n`;

      if (contentsOut === `{}\n`) {
        await fs.promises.rm(configFile);
      } else {
        await fs.promises.writeFile(configFile, contentsOut, { encoding: 'utf8' });
      }
    } catch {}
  }

  async deleteSetting(setting: string): Promise<void> {
    const configFile = `${this.directory}/${setting}.json`;
    try {
      await fs.promises.rm(configFile);
    } catch {}
  }

  async listSettings(): Promise<string[]> {
    try {
      return (await fs.promises.readdir(this.directory)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  async listKeys(setting: string): Promise<string[]> {
    return Object.keys(await this.readJsonObject(setting));
  }

  async readJsonObject(setting: string) {
    const configFile = `${this.directory}/${setting}.json`;
    try {
      const contents = await fs.promises.readFile(configFile, { encoding: 'utf8' });
      return JSON.parse(contents);
    } catch {
      return {};
    }
  }
}

export { makeXdgPersistenceManager, PersistenceManager };
