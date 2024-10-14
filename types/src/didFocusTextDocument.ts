import { ProtocolNotificationType } from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';

namespace DidFocusTextDocumentNotification {
  export const method = 'textDocument/didFocus';
  export const type = new ProtocolNotificationType<TextDocument | { textDocument: TextDocument }, unknown>(method);
}

export { DidFocusTextDocumentNotification };
