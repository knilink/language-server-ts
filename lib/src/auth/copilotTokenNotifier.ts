import { default as EventEmitter } from 'node:events';
import { type CopilotToken } from './copilotToken.ts';

class CopilotTokenNotifier extends EventEmitter<{ onCopilotToken: [CopilotToken] }> {
  constructor() {
    super();
    this.setMaxListeners(14);
  }
}

export { CopilotTokenNotifier };
