import { MessageActionItem } from 'vscode-languageserver';
import { NotificationSender } from '../notificationSender.ts';
import { Deferred } from '../util/async.ts';
import { UrlOpener } from '../util/opener.ts';

class TestUrlOpener extends UrlOpener {
  openedUrls: string[] = [];
  opened = new Deferred<void>();

  async open(target: string) {
    this.openedUrls.push(target);
    this.opened.resolve();
  }
}

class TestNotificationSender extends NotificationSender {
  sentMessages: string[] = [];
  warningPromises: Promise<MessageActionItem | undefined>[] = [];
  actionToPerform?: string;

  constructor() {
    super();
  }

  performDismiss() {
    this.actionToPerform = 'DISMISS';
  }

  performAction(title: string) {
    this.actionToPerform = title;
  }

  showWarningMessage(message: string, ...actions: MessageActionItem[]) {
    this.sentMessages.push(message);
    let warningPromise;
    if (this.actionToPerform) {
      if (this.actionToPerform === 'DISMISS') {
        warningPromise = Promise.resolve(undefined);
      } else {
        let action = actions.find((a) => a.title === this.actionToPerform);
        warningPromise = action ? Promise.resolve(action) : Promise.resolve(undefined);
      }
    } else {
      warningPromise = actions ? Promise.resolve(actions[0]) : Promise.resolve(undefined);
    }
    this.warningPromises.push(warningPromise);
    return warningPromise;
  }

  async waitForWarningMessages() {
    await Promise.all(this.warningPromises);
  }
}

export { TestNotificationSender, TestUrlOpener };
