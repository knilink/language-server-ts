import { Context } from '../../lib/src/context.ts';
import { Service } from './service.ts';
import { SpawnUrlOpener } from '../../lib/src/util/opener.ts';
import { UrlOpener } from '../../lib/src/util/opener.ts';

class AgentUrlOpener extends UrlOpener {
  constructor(
    readonly ctx: Context,
    readonly fallback = new SpawnUrlOpener()
  ) {
    super();
  }

  public async open(uri: string): Promise<void> {
    const service = this.ctx.get(Service);
    if (
      !(
        service.clientCapabilities?.window?.showDocument?.support &&
        (await service.connection.window.showDocument({ uri, external: true })).success
      )
    )
      await this.fallback.open(uri);
  }
}

export { AgentUrlOpener };
