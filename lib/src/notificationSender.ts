import { MessageActionItem } from 'vscode-languageserver';

interface NotificationMessage {
  title: string;
}

abstract class NotificationSender {
  async showWarningMessageOnlyOnce(
    // undefined ./auth/copilotToken.ts
    _id: string | undefined,
    message: string | NotificationMessage | undefined,
    ...actions: MessageActionItem[]
  ): Promise<MessageActionItem | undefined> {
    return this.showWarningMessage(message, ...actions);
  }

  // Abstract method to be implemented by subclasses
  abstract showWarningMessage(
    message:
      | string
      // ./auth/copilotToken.ts
      | NotificationMessage
      | undefined,
    ...actions: MessageActionItem[]
  ): Promise<MessageActionItem | undefined>;
}

export { NotificationSender };
