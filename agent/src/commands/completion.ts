import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../cancellation';

import { AbstractCommand } from './abstract';
import { CopilotCompletionCache } from '../copilotCompletionCache';
import { handleGhostTextPostInsert } from '../../../lib/src/ghostText/last';

const didAcceptCommand = 'github.copilot.didAcceptCompletionItem';

const Args = Type.Tuple([Type.String({ minLength: 1 })]);

class DidAcceptCommand extends AbstractCommand {
  readonly name = didAcceptCommand;
  arguments = Args;

  async handle(_token: CancellationToken, [id]: Static<typeof Args>): Promise<boolean> {
    const completion = this.ctx.get(CopilotCompletionCache).get(id);
    if (completion) {
      await handleGhostTextPostInsert(this.ctx, completion);
      return true;
    }
    return false;
  }
}

const completionCommands = [DidAcceptCommand];

export { didAcceptCommand, DidAcceptCommand, completionCommands };
