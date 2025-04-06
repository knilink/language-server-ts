import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { AuthStatus } from '../../../lib/src/auth/types.ts';

import { ResponseError } from '../../../node_modules/vscode-languageserver-protocol/lib/node/main.js';
import { AbstractCommand } from './abstract.ts';
import { ErrorCode } from '../rpc.ts';
import { authLogger } from '../../../lib/src/auth/copilotToken.ts';
import { AuthManager } from '../../../lib/src/auth/manager.ts';
import { UrlOpener } from '../../../lib/src/util/opener.ts';
import { Type } from '@sinclair/typebox';

const finishDeviceFlowCommand = 'github.copilot.finishDeviceFlow';

const Args = Type.Tuple([]);

class FinishDeviceFlowCommand extends AbstractCommand {
  readonly name = finishDeviceFlowCommand;
  arguments = Args;

  async handle(_token: CancellationToken, _args: Static<typeof Args>): Promise<AuthStatus> {
    const pendingSignIn = this.ctx.get(AuthManager).pendingSignIn;
    if (!pendingSignIn) {
      throw new ResponseError(ErrorCode.InvalidRequest, 'No pending sign in');
    }
    try {
      await this.ctx.get(UrlOpener).open(pendingSignIn.verificationUri);
    } catch (e) {
      authLogger.warn(this.ctx, 'Failed to open', pendingSignIn.verificationUri);
      authLogger.exception(this.ctx, e, finishDeviceFlowCommand);
    }
    try {
      return await pendingSignIn.status;
    } catch (e) {
      throw new ResponseError(ErrorCode.DeviceFlowFailed, String(e));
    } finally {
      this.ctx.get(AuthManager).pendingSignIn = undefined;
    }
  }
}

const authCommands = [FinishDeviceFlowCommand];

export { authCommands, finishDeviceFlowCommand };
