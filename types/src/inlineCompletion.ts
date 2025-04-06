import {
  ProtocolRequestType,
  ProtocolNotificationType,
  InlineCompletionTriggerKind as Foo,
} from 'vscode-languageserver-protocol';
import { OptionalVersionedTextDocumentIdentifierSchema, PositionSchema, RangeSchema } from './core.ts';
import { Type, type Static } from '@sinclair/typebox';

// MARK InlineCompletionTriggerKind in 'vscode-languageserver-protocol' is Invoked = 0, Automatic = 1
enum InlineCompletionTriggerKind {
  Invoked = 1,
  Automatic = 2,
}

const InlineCompletionTriggerKindSchema = Type.Enum(InlineCompletionTriggerKind);

const CopilotInlineCompletionContextSchema = Type.Object({
  triggerKind: InlineCompletionTriggerKindSchema,
  selectedCompletionInfo: Type.Optional(
    Type.Object({ text: Type.String(), range: RangeSchema, tooltipSignature: Type.Optional(Type.String()) })
  ),
});

const CopilotInlineCompletionSchema = Type.Object({
  textDocument: OptionalVersionedTextDocumentIdentifierSchema,
  position: PositionSchema,
  formattingOptions: Type.Optional(
    Type.Object({ tabSize: Type.Integer({ minimum: 1 }), insertSpaces: Type.Boolean() })
  ),
  context: CopilotInlineCompletionContextSchema,
  data: Type.Optional(Type.Unknown()),
});

type CopilotInlineCompletionSchemaType = Static<typeof CopilotInlineCompletionSchema>;

namespace CopilotInlineCompletionRequest {
  export const method = 'textDocument/inlineCompletion';
  export const type = new ProtocolRequestType<CopilotInlineCompletionSchemaType, unknown, unknown, unknown, unknown>(
    method
  );
}

const NotificationCommandSchema = Type.Object({
  command: Type.Object({ arguments: Type.Tuple([Type.String({ minLength: 1 })]) }),
});

const DidShowCompletionParams = Type.Object({ item: NotificationCommandSchema });

type DidShowCompletionParamsType = Static<typeof DidShowCompletionParams>;

namespace DidShowCompletionNotification {
  export const method = 'textDocument/didShowCompletion';
  export const type = new ProtocolNotificationType<DidShowCompletionParamsType, unknown>(method);
}

const DidPartiallyAcceptCompletionParams = Type.Object({
  item: NotificationCommandSchema,
  acceptedLength: Type.Integer({ minimum: 1 }),
});

type DidPartiallyAcceptCompletionParamsType = Static<typeof DidPartiallyAcceptCompletionParams>;

namespace DidPartiallyAcceptCompletionNotification {
  export const method = 'textDocument/didPartiallyAcceptCompletion';
  export const type = new ProtocolNotificationType<DidPartiallyAcceptCompletionParamsType, unknown>(method);
}

export {
  CopilotInlineCompletionRequest,
  CopilotInlineCompletionSchema,
  CopilotInlineCompletionSchemaType,
  DidPartiallyAcceptCompletionNotification,
  DidPartiallyAcceptCompletionParams,
  DidPartiallyAcceptCompletionParamsType,
  DidShowCompletionNotification,
  DidShowCompletionParams,
  DidShowCompletionParamsType,
  InlineCompletionTriggerKind,
};
