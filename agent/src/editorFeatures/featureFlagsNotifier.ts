import { NotificationType } from 'vscode-languageserver';
import { type Context } from '../../../lib/src/context.ts';
import { CopilotTokenNotifier } from '../../../lib/src/auth/copilotTokenNotifier.ts';
import { Service } from '../service.ts';
import { Features } from '../../../lib/src/experiments/features.ts';

type FeatureFlagsNotification = {
  rt: boolean;
  sn: boolean;
  chat: boolean;
  ic: boolean;
  ep: boolean;
  pc: boolean;
  x?: boolean;
  xc?: boolean;
};

class FeatureFlagsNotifier {
  notificationType = new NotificationType<FeatureFlagsNotification>('featureFlagsNotbification');
  notificationEndpoint = 'featureFlagsNotification';

  constructor(readonly ctx: Context) {
    this.ctx.get(CopilotTokenNotifier).on('onCopilotToken', async (token) => {
      let extensibilityPlatformEnabled = false;
      let projectContextEnabled = false;
      if (token.envelope.chat_enabled) {
        const features = ctx.get(Features);
        const telemetryDataWithExp = await features.updateExPValuesAndAssignments();
        extensibilityPlatformEnabled = features.ideChatEnableExtensibilityPlatform(telemetryDataWithExp);
        projectContextEnabled = features.ideChatEnableProjectContext(telemetryDataWithExp);
      }
      const xcodeFlags: FeatureFlagsNotification = {
        rt: token.getTokenValue('rt') === '1',
        sn: token.getTokenValue('sn') === '1',
        chat: token.envelope.chat_enabled ?? false,
        ic: token.envelope.chat_enabled ?? false,
        ep: extensibilityPlatformEnabled,
        pc: projectContextEnabled,
      };

      if (token.envelope.xcode) {
        xcodeFlags.x = true;
      }

      if (token.envelope.xcode_chat && token.envelope.chat_enabled) {
        xcodeFlags.xc = true;
      }

      await this.sendNotification(xcodeFlags);
    });
  }

  async sendNotification(notification: FeatureFlagsNotification): Promise<void> {
    await this.ctx
      .get(Service)
      .connection.sendNotification(new NotificationType(this.notificationEndpoint), notification);
  }
}

export { FeatureFlagsNotifier };
