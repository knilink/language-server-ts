import { Context } from '../context';
import { UrlOpener } from '../util/opener';
import { Logger, LogLevel } from '../logger';
import { NotificationSender } from '../notificationSender';

const CERTIFICATE_ERRORS = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_SIGNATURE_FAILURE'];
const errorMsg =
  'Your proxy connection requires a trusted certificate. Please make sure the proxy certificate and any issuers are configured correctly and trusted by your operating system.';
const learnMoreLink = 'https://gh.io/copilot-network-errors';

class UserErrorNotifier {
  private notifiedErrorCodes: string[] = [];

  async notifyUser(ctx: Context, error: unknown): Promise<void> {
    if (CERTIFICATE_ERRORS.includes((error as any).code) && !this.didNotifyBefore((error as any).code)) {
      this.displayCertificateErrorNotification(ctx, error);
      this.notifiedErrorCodes.push((error as any).code);
    }
  }

  private displayCertificateErrorNotification(ctx: Context, err: unknown): void {
    const logger = new Logger(LogLevel.ERROR, 'certificates');
    logger.error(
      ctx,
      `${errorMsg} Please visit ${learnMoreLink} to learn more. Original cause: ${JSON.stringify(err)}`
    );
    this.showCertificateWarningMessage(ctx);
  }

  private async showCertificateWarningMessage(ctx: Context): Promise<void> {
    const learnMoreAction = { title: 'Learn more' };
    const userResponse = await ctx.get(NotificationSender).showWarningMessage(errorMsg, learnMoreAction);
    if (userResponse?.title === learnMoreAction.title) {
      ctx.get(UrlOpener).open(learnMoreLink);
    }
  }

  private didNotifyBefore(code: string): boolean {
    return this.notifiedErrorCodes.indexOf(code) !== -1;
  }
}

export { UserErrorNotifier };
