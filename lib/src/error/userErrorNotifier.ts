import { Context } from '../context.ts';
import { UrlOpener } from '../util/opener.ts';
import { Logger } from '../logger.ts';
import { NotificationSender } from '../notificationSender.ts';

const CERTIFICATE_ERRORS = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_SIGNATURE_FAILURE'];
const errorMsg =
  'Your proxy connection requires a trusted certificate. Please make sure the proxy certificate and any issuers are configured correctly and trusted by your operating system.';
const learnMoreLink = 'https://gh.io/copilot-network-errors';

class UserErrorNotifier {
  notifiedErrorCodes: string[] = [];

  notifyUser(ctx: Context, error: unknown): void {
    if (
      error instanceof Error &&
      'code' in error &&
      CERTIFICATE_ERRORS.includes(error.code as string) &&
      !this.didNotifyBefore(error.code as string)
    ) {
      this.notifiedErrorCodes.push(error.code as string);
      this.displayCertificateErrorNotification(ctx, error);
    }
  }

  async displayCertificateErrorNotification(ctx: Context, err: unknown): Promise<void> {
    const logger = new Logger('certificates');
    logger.error(ctx, `${errorMsg} Please visit ${learnMoreLink} to learn more. Original cause:`, err);
    const learnMoreAction = { title: 'Learn more' };
    const userResponse = await ctx.get(NotificationSender).showWarningMessage(errorMsg, learnMoreAction);
    if (userResponse?.title === learnMoreAction.title) {
      return await ctx.get(UrlOpener).open(learnMoreLink);
    }
  }

  didNotifyBefore(code: string): boolean {
    return this.notifiedErrorCodes.indexOf(code) !== -1;
  }
}

export { UserErrorNotifier };
