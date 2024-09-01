import EventEmitter from 'events';
import { CopilotToken } from "./copilotToken.ts";

class CopilotTokenNotifier extends EventEmitter<{ onCopilotToken: [CopilotToken] }> {
  constructor() {
    super();
    this.setMaxListeners(14);
  }
}

export { CopilotTokenNotifier };
