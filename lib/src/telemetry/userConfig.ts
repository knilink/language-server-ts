import { Context } from "../context.ts";
import { CopilotTokenNotifier } from "../auth/copilotTokenNotifier.ts";

class TelemetryUserConfig {
  organizationsList?: string;
  enterpriseList?: string;
  sku?: string;

  constructor(
    ctx: Context,
    public trackingId?: string,
    public optedIn: boolean = false,
    public ftFlag: string = ''
  ) {
    this.setupUpdateOnToken(ctx);
  }

  setupUpdateOnToken(ctx: Context): void {
    const copilotTokenNotifier = ctx.get(CopilotTokenNotifier);
    copilotTokenNotifier.on('onCopilotToken', (copilotToken) => {
      const restrictedTelemetry = copilotToken.getTokenValue('rt') === '1';
      const ftFlag = copilotToken.getTokenValue('ft') || '';
      const trackingId = copilotToken.getTokenValue('tid');
      const organizationsList = copilotToken.organization_list;
      const enterpriseList = copilotToken.enterprise_list;
      const sku = copilotToken.getTokenValue('sku');

      if (trackingId !== undefined) {
        this.trackingId = trackingId;
        this.organizationsList = organizationsList?.toString();
        this.enterpriseList = enterpriseList?.toString();
        this.sku = sku;
        this.optedIn = restrictedTelemetry;
        this.ftFlag = ftFlag;
      }
    });
  }
}

export { TelemetryUserConfig };
