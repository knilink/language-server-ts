import type { Context } from '../../../lib/src/context.ts';

import { NotificationType } from '../../../node_modules/vscode-languageserver/node.js';
import { Service } from '../service.ts';
import { onCopilotToken } from '../../../lib/src/auth/copilotTokenNotifier.ts';
import { Features } from '../../../lib/src/experiments/features.ts';
import { isDebugEnabled } from '../../../lib/src/testing/runtimeMode.ts';

interface FeatureFlagsNotification {
  rt: boolean;
  sn: boolean;
  chat: boolean;
  ic: boolean;
  pc: boolean;
  jcp: boolean;
  ce: boolean;
  xc?: boolean;
}

class FeatureFlagsNotifier {
  notificationType = new NotificationType<FeatureFlagsNotification>('featureFlagsNotbification');
  notificationEndpoint = 'featureFlagsNotification';

  constructor(readonly ctx: Context) {
    onCopilotToken(ctx, async (token) => {
      let projectContextEnabled = false;
      let features = ctx.get(Features);
      let telemetryDataWithExp = await features.updateExPValuesAndAssignments();
      let javaLspContextProvider = features
        .contextProviders(telemetryDataWithExp)
        .includes('java-lsp-context-provider');
      let copilotEditsEnabled = false;
      if (token.envelope.chat_enabled) {
        let features = ctx.get(Features);
        let telemetryDataWithExp = await features.updateExPValuesAndAssignments();
        projectContextEnabled = features.ideChatEnableProjectContext(telemetryDataWithExp);
        copilotEditsEnabled = features.ideEnableCopilotEdits(telemetryDataWithExp);
      }
      const xcodeFlags: Pick<FeatureFlagsNotification, 'xc'> = {};

      if (token.envelope.xcode_chat && token.envelope.chat_enabled) {
        xcodeFlags.xc = true;
      }

      await this.sendNotification({
        rt: token.getTokenValue('rt') === '1',
        sn: token.getTokenValue('sn') === '1',
        chat: token.envelope.chat_enabled ?? false,
        ic: token.envelope.chat_enabled ?? false,
        pc: projectContextEnabled,
        jcp: javaLspContextProvider || isDebugEnabled(ctx),
        ce: copilotEditsEnabled,
        ...xcodeFlags,
      });
    });
  }

  async sendNotification(notification: FeatureFlagsNotification): Promise<void> {
    await this.ctx
      .get(Service)
      .connection.sendNotification(new NotificationType(this.notificationEndpoint), notification);
  }
}

export { FeatureFlagsNotifier };
