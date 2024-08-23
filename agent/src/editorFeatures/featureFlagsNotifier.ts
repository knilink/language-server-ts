import { NotificationType } from 'vscode-languageserver';
import { type Context } from '../../../lib/src/context';
import { CopilotTokenNotifier } from '../../../lib/src/auth/copilotTokenNotifier';
import { Service } from '../service';

type FeatureFlagsNotification = {
  rt: boolean;
  sn: boolean;
  chat: boolean;
};

class FeatureFlagsNotifier {
  notificationType = new NotificationType<FeatureFlagsNotification>('featureFlagsNotbification');

  constructor(readonly ctx: Context) {
    this.ctx.get(CopilotTokenNotifier).on('onCopilotToken', (token) => {
      this.sendNotification({
        rt: token.getTokenValue('rt') === '1',
        sn: token.getTokenValue('sn') === '1',
        chat: token.envelope.chat_enabled ?? false,
      });
    });
  }

  private sendNotification(notification: FeatureFlagsNotification): void {
    this.ctx.get(Service).connection.sendNotification(this.notificationType, notification);
  }
}

export { FeatureFlagsNotifier };
