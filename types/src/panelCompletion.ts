import { ProtocolRequestType, ProgressType } from 'vscode-languageserver-protocol';
import { OptionalVersionedTextDocumentIdentifierSchema, PositionSchema, ProgressTokenSchema } from './core.ts';
import { Type, type Static } from '@sinclair/typebox';

const CopilotPanelCompletionParams = Type.Object({
  textDocument: OptionalVersionedTextDocumentIdentifierSchema,
  position: PositionSchema,
  partialResultToken: Type.Optional(ProgressTokenSchema),
  workDoneToken: Type.Optional(ProgressTokenSchema),
});

type CopilotPanelCompletionParamsType = Static<typeof CopilotPanelCompletionParams>;

namespace CopilotPanelCompletionRequest {
  export const method = 'textDocument/copilotPanelCompletion';
  export const type = new ProtocolRequestType<CopilotPanelCompletionParamsType, unknown, unknown, unknown, unknown>(
    method
  );
  export const partialResult = new ProgressType();
}

export { CopilotPanelCompletionParams, CopilotPanelCompletionRequest, CopilotPanelCompletionParamsType };
