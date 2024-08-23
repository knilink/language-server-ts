import { MessageActionItem } from 'vscode-languageserver';

abstract class NotificationSender {
  async showWarningMessageOnlyOnce<T extends MessageActionItem>(
    message: string,
    ...actions: T[]
  ): Promise<T | undefined> {
    return this.showWarningMessage(message, ...actions);
  }

  // Abstract method to be implemented by subclasses
  abstract showWarningMessage<T extends MessageActionItem>(message: string, ...actions: T[]): Promise<T | undefined>;
}

export { NotificationSender };
