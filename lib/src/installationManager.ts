import { type Context } from "./context.ts";
import { telemetry } from "./telemetry.ts";

abstract class InstallationManager {
  abstract isNewInstall(ctx: Context): Promise<boolean>;
  abstract wasPreviouslyInstalled(ctx: Context): Promise<boolean>;
  abstract markInstalled(ctx: Context): Promise<void>;
  abstract isNewUpgrade(ctx: Context): Promise<boolean>;
  abstract markUpgraded(ctx: Context): Promise<void>;

  async startup(ctx: Context): Promise<void> {
    const isNewInstall = await this.isNewInstall(ctx);
    if (isNewInstall) {
      const wasPreviouslyInstalled = await this.wasPreviouslyInstalled(ctx);
      await this.handleInstall(ctx, wasPreviouslyInstalled);
      await this.markInstalled(ctx);
    } else {
      const isNewUpgrade = await this.isNewUpgrade(ctx);
      if (isNewUpgrade) {
        await this.handleUpgrade(ctx);
        await this.markUpgraded(ctx);
      }
    }
  }

  async uninstall(ctx: Context): Promise<void> {
    await this.handleUninstall(ctx);
  }

  private async handleInstall(ctx: Context, previouslyInstalled: boolean): Promise<void> {
    telemetry(ctx, previouslyInstalled ? 'installed.reinstall' : 'installed.new');
  }

  private async handleUpgrade(ctx: Context): Promise<void> {
    telemetry(ctx, 'installed.upgrade');
  }

  private async handleUninstall(ctx: Context): Promise<void> {
    telemetry(ctx, 'uninstalled');
  }
}

export { InstallationManager };
