import { ProtocolNotificationType } from 'vscode-languageserver-protocol';
import { Type, type Static } from '@sinclair/typebox';

const DidChangeAuthParams = Type.Object({
  accessToken: Type.Optional(Type.String({ minLength: 1 })),
  handle: Type.Optional(Type.String({ minLength: 1 })),
  githubAppId: Type.Optional(Type.String({ minLength: 1 })),
});

type DidChangeAuthParamsType = Static<typeof DidChangeAuthParams>;

namespace DidChangeAuthNotification {
  export const method = 'github/didChangeAuth';
  export const type = new ProtocolNotificationType<DidChangeAuthParamsType, unknown>(method);
}

export { DidChangeAuthNotification, DidChangeAuthParams, DidChangeAuthParamsType };
