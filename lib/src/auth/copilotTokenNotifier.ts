import { Disposable } from 'vscode-languageserver/node.js';
import type { Context } from '../context.ts';
import { telemetryCatch } from '../telemetry.ts';
import { default as EventEmitter } from 'node:events';
import { type CopilotToken } from './copilotToken.ts';
import type {} from '../../../types/src/index.ts';

function onCopilotToken(ctx: Context, listener: (token: CopilotToken) => void | Promise<void>): Disposable {
  let wrapper = telemetryCatch(ctx, listener, `event.${eventName}`);
  return ctx.get(CopilotTokenNotifier).onToken(wrapper);
}

function emitCopilotToken(
  ctx: Context,
  // ./copilotToken.ts
  token: CopilotToken
) {
  return ctx.get(CopilotTokenNotifier).emitToken(token);
}

const eventName = 'CopilotToken';

class CopilotTokenNotifier extends EventEmitter<{ onCopilotToken: [CopilotToken] }> {
  private _emitter = new EventEmitter();
  private _lastToken?: CopilotToken;

  constructor() {
    super();
    this._emitter.setMaxListeners(14);
  }

  emitToken(token: CopilotToken) {
    if (token.token !== this._lastToken?.token) {
      this._lastToken = token;
      return this._emitter.emit(eventName, token);
    }
  }

  onToken(listener: (token: CopilotToken) => void): Disposable {
    this._emitter.on(eventName, listener);
    return Disposable.create(() => this._emitter.off(eventName, listener));
  }
}

export { CopilotTokenNotifier, emitCopilotToken, onCopilotToken };
