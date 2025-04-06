import * as lsp from 'vscode-languageserver-protocol';

namespace CopilotInlineCompletionPromptRequest {
  export const method = 'textDocument/inlineCompletionPrompt';
  export const type = new lsp.ProtocolRequestType(CopilotInlineCompletionPromptRequest.method);
}

export { CopilotInlineCompletionPromptRequest };
