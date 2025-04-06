import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';
import type { CopilotTextDocument } from '../../../../lib/src/textDocument.ts';
import type { TelemetryMeasurements } from '../../../../lib/src/types.ts';

import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { ErrorCode } from '../../rpc.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { getTextDocumentChecked } from '../../textDocument.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import { ConversationSourceSchema, DocumentSchema } from '../../../../lib/src/conversation/schema.ts';
import {
  conversationSourceToUiKind,
  createTelemetryWithExpWithId,
  telemetryPrefixForUiKind,
  telemetryUserAction,
} from '../../../../lib/src/conversation/telemetry.ts';
import { Type } from '@sinclair/typebox';

const SourceSchema = Type.Union([Type.Literal('keyboard'), Type.Literal('toolbar')]);

const Params = Type.Object({
  turnId: Type.String(),
  codeBlockIndex: Type.Number(),
  source: SourceSchema,
  copiedCharacters: Type.Number(),
  totalCharacters: Type.Number(),
  copiedText: Type.String(),
  doc: Type.Optional(DocumentSchema),
  options: Type.Optional(TestingOptions),
  conversationSource: Type.Optional(ConversationSourceSchema),
});

async function handleConversationCodeCopyChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null] | [null, { code: number; message: string }]> {
  let textDocument: CopilotTextDocument | undefined;

  if (params.doc) {
    const result = await getTextDocumentChecked(ctx, params.doc.uri);
    if (result.status === 'notfound') return [null, { code: ErrorCode.InvalidParams, message: result.message }];
    if (result.status === 'valid') textDocument = result.document;
  }

  const measurements: TelemetryMeasurements = {
    totalCharacters: params.totalCharacters,
    copiedCharacters: params.copiedCharacters,
  };
  if (textDocument && params.doc?.position) {
    measurements['currentLine'] = params.doc.position.line;
  }

  const uiKind = conversationSourceToUiKind(params.conversationSource);
  const telemetryWithExp = await createTelemetryWithExpWithId(
    ctx,
    params.turnId,
    ctx.get(Conversations).findByTurnId(params.turnId)?.id ?? '',
    { languageId: textDocument?.languageId ?? '' }
  );

  telemetryUserAction(
    ctx,
    textDocument,
    { codeBlockIndex: params.codeBlockIndex.toString(), source: params.source, uiKind },
    measurements,
    `${telemetryPrefixForUiKind(uiKind)}.acceptedCopy`,
    telemetryWithExp
  );
  return ['OK', null];
}

const handleConversationCodeCopy = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationCodeCopyChecked)
);

export { handleConversationCodeCopy };
