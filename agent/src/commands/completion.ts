import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../cancellation.ts';

import { AbstractCommand } from './abstract.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { handleGhostTextPostInsert } from '../../../lib/src/ghostText/last.ts';

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
