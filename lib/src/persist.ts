import type { AuthRecord } from './auth/types.ts';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';

interface IPersistenceManager {
  read(setting: string, key: string): Promise<unknown>;
  update(setting: string, key: string, value: unknown): Promise<void>;
  delete(setting: string, key: string): Promise<void>;
  deleteSetting(setting: string): Promise<void>;
  listSettings(): Promise<string[]>;
  listKeys(setting: string): Promise<string[]>;
}

function getXdgConfigPath() {
  return process.env.XDG_CONFIG_HOME && path.isAbsolute(process.env.XDG_CONFIG_HOME)
    ? process.env.XDG_CONFIG_HOME + '/github-copilot'
    : os.platform() === 'win32'
      ? process.env.USERPROFILE + '\\AppData\\Local\\github-copilot'
      : process.env.HOME + '/.config/github-copilot';
}

function makeXdgPersistenceManager(): PersistenceManager {
  const configPath = getXdgConfigPath();
  return new PersistenceManager(configPath);
}

class PersistenceManager implements IPersistenceManager {
  constructor(readonly directory: string) {}

  async read(setting: string, key: string): Promise<unknown> {
    const configFile = `${this.directory}/${setting}.json`;
    try {
      const contents = await fs.promises.readFile(configFile, { encoding: 'utf8' });
      return JSON.parse(contents)[key];
    } catch (error) {}
  }

  async update(setting: string, key: string, value: unknown): Promise<void> {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const configFile = `${this.directory}/${setting}.json`;
    let contentsJSON: Record<string, unknown> = {};

    try {
      const contents = await fs.promises.readFile(configFile, { encoding: 'utf8' });
      contentsJSON = JSON.parse(contents);
    } catch (error) {}

    contentsJSON[key] = value;
    await fs.promises.writeFile(configFile, `${JSON.stringify(contentsJSON)}\n`, { encoding: 'utf8' });
  }

  async delete(setting: string, key: string): Promise<void> {
    const configFile = `${this.directory}/${setting}.json`;
    try {
      const contents = await fs.promises.readFile(configFile, { encoding: 'utf8' });
      let contentsJSON = JSON.parse(contents);
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
    const files = await fs.promises.readdir(this.directory);
    return files.filter((file) => file.endsWith('.json')).map((file) => path.basename(file, '.json'));
  }

  async listKeys(setting: string): Promise<string[]> {
    const configFile = `${this.directory}/${setting}.json`;
    try {
      const contents = await fs.promises.readFile(configFile, { encoding: 'utf8' });
      return Object.keys(JSON.parse(contents));
    } catch {
      return [];
    }
  }
}

export { makeXdgPersistenceManager, PersistenceManager, IPersistenceManager };
