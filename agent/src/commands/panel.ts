import { Type, type Static } from '@sinclair/typebox';

import { type CancellationToken } from '../cancellation.ts';
import { AbstractCommand } from './abstract.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { postInsertionTasks } from '../../../lib/src/postInsertion.ts';

const didAcceptPanelCompletionItemCommand = 'github.copilot.didAcceptPanelCompletionItem';

const Args = Type.Tuple([Type.String({ minLength: 1 })]);

class DidAcceptPanelCompletionItemCommand extends AbstractCommand {
  readonly name = didAcceptPanelCompletionItemCommand;
  arguments = Args;

  async handle(_token: CancellationToken, args: Static<typeof Args>): Promise<boolean> {
    const [uuid] = args;
    const completion = this.ctx.get(CopilotCompletionCache).get(uuid);

    if (completion) {
      await postInsertionTasks(
        this.ctx,
        completion.triggerCategory,
        completion.insertText, //
        completion.offset,
        completion.file,
        completion.telemetry,
        { compType: 'full' },
        completion.uuid,
        completion.range.start
      );
      return true;
    } else {
      return false;
    }
  }
}

const panelCommands = [DidAcceptPanelCompletionItemCommand];

export { DidAcceptPanelCompletionItemCommand, panelCommands, didAcceptPanelCompletionItemCommand };
