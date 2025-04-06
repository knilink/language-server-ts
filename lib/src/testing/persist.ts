import { PersistenceManager } from '../persist.ts';

class InMemoryPersistenceManager extends PersistenceManager {
  settings = new Map();

  get directory(): never {
    throw new Error('Not supported');
  }

  async read(setting: string, key: string) {
    try {
      return this.readJsonObject(setting)[key];
    } catch {
      return;
    }
  }

  async update(setting: string, key: string, value: unknown) {
    let contentsJSON = this.readJsonObject(setting);
    contentsJSON[key] = value;
    this.settings.set(setting, contentsJSON);
  }

  async delete(setting: string, key: string) {
    let contentsJSON = this.readJsonObject(setting);
    delete contentsJSON[key];
    this.settings.set(setting, contentsJSON);
  }

  async deleteSetting(setting: string) {
    this.settings.delete(setting);
  }

  async listSettings() {
    return [...this.settings.keys()];
  }

  async listKeys(setting: string) {
    return Object.keys(this.readJsonObject(setting));
  }

  readJsonObject(setting: string) {
    return this.settings.get(setting) ?? {};
  }
}

export { InMemoryPersistenceManager };
