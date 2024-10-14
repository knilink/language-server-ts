import { ProtocolNotificationType } from '../../node_modules/vscode-languageserver-protocol/lib/node/main.js';

namespace StatusNotificationNotification {
  export const method = 'statusNotification';
  export const type = new ProtocolNotificationType(method);
}

export { StatusNotificationNotification };
