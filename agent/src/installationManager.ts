import * as semver from 'semver';
import { type Context } from "../../lib/src/context.ts";

import { EditorAndPluginInfo } from "../../lib/src/config.ts";
import { PersistenceManager } from "../../lib/src/persist.ts";
import { InstallationManager } from "../../lib/src/installationManager.ts";

// ../agent/src/installationManager.ts

class AgentInstallationManager extends InstallationManager {
  async isNewInstall(ctx: Context): Promise<boolean> {
    const info = ctx.get(EditorAndPluginInfo).getEditorPluginInfo();
    return (
      (await ctx.get(PersistenceManager).read('versions', info.name)) === undefined &&
      !(await this.hasPersistedSettings(ctx))
    );
  }

  async hasPersistedSettings(ctx: Context): Promise<boolean> {
    const settings = await ctx.get(PersistenceManager).listSettings();
    return settings.length > 0;
  }

  async markInstalled(ctx: Context): Promise<void> {
    const info = ctx.get(EditorAndPluginInfo).getEditorPluginInfo();
    await ctx.get(PersistenceManager).update('versions', info.name, info.version);
  }

  async wasPreviouslyInstalled(ctx: Context): Promise<boolean> {
    return false;
  }

  async isNewUpgrade(ctx: Context): Promise<boolean> {
    try {
      const info = ctx.get(EditorAndPluginInfo).getEditorPluginInfo();
      const knownVersion = (await ctx.get(PersistenceManager).read('versions', info.name)) as
        | string
        | number
        | undefined;
      return knownVersion === undefined && (await this.hasPersistedSettings(ctx))
        ? true
        : semver.gt(semver.coerce(info.version)!, semver.coerce(knownVersion)!);
    } catch {
      return false;
    }
  }

  async markUpgraded(ctx: Context): Promise<void> {
    await this.markInstalled(ctx);
  }

  async uninstall(ctx: Context): Promise<void> {
    await super.uninstall(ctx);
    const info = ctx.get(EditorAndPluginInfo).getEditorPluginInfo();
    await ctx.get(PersistenceManager).delete('versions', info.name);
    if ((await ctx.get(PersistenceManager).listKeys('versions')).length === 0) {
      await ctx.get(PersistenceManager).deleteSetting('versions');
    }
  }
}

export { AgentInstallationManager };
