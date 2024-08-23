import { Context } from '../../lib/src/context';
import { Service } from './service';
import { SpawnUrlOpener } from '../../lib/src/util/opener';
import { UrlOpener } from '../../lib/src/util/opener';

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
