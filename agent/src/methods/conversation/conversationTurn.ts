import { TestingOptions } from '../testingOptions.ts';
import { TurnProcessorFactory } from '../../conversation/turnProcessorFactory.ts';
import { ProgressTokens } from '../../progressTokens.ts';
import { ErrorCode } from '../../rpc.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { getTextDocumentChecked } from '../../textDocument.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import { Turn } from '../../../../lib/src/conversation/conversation.ts';
import { ChatConfirmationResponseSchema } from '../../../../lib/src/conversation/openai/openai.ts';
import { DocumentSchema, ReferenceSchema } from '../../../../lib/src/conversation/schema.ts';
import { TurnContext } from '../../../../lib/src/conversation/turnContext.ts';
import { Type } from '@sinclair/typebox';

import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';
import type { CopilotTextDocument } from '../../../../lib/src/textDocument.ts';

async function handleConversationTurnChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<
  | [{ conversationId: string; turnId: string; agentSlug?: string; modelFamily?: string }, null]
  | [null, { code: number; message: string }]
> {
  let textDocument: CopilotTextDocument | undefined;

  if (params.doc) {
    const result = await getTextDocumentChecked(ctx, params.doc.uri);
    if (result.status === 'notfound') return [null, { code: ErrorCode.InvalidParams, message: result.message }];
    if (result.status === 'valid') textDocument = result.document;
  }

  const conversations = ctx.get(Conversations);
  const conversation = conversations.get(params.conversationId);
  const turn = await conversations.addTurn(
    conversation.id,
    new Turn({ message: params.message, type: 'user' }),
    params.references,
    params.workspaceFolder,
    params.ignoredSkills,
    params.confirmationResponse
  );
  const mergedToken = ctx.get(ProgressTokens).add(params.workDoneToken, token);
  const turnContext = new TurnContext(ctx, conversation, turn, mergedToken);
  await (
    await ctx.get(TurnProcessorFactory).createProcessor(turnContext, params.workDoneToken, params.computeSuggestions)
  ).process(params.workDoneToken, mergedToken, params.followUp, textDocument, params.model);
  return [
    {
      conversationId: conversation.id,
      turnId: turn.id,
      agentSlug: turn.agent?.agentSlug,
      modelFamily: params.model,
    },
    null,
  ];
}

const Params = Type.Object({
  workDoneToken: Type.Union([Type.String(), Type.Number()]),
  conversationId: Type.String(),
  message: Type.String(),
  followUp: Type.Optional(Type.Object({ id: Type.String(), type: Type.String() })),
  options: Type.Optional(TestingOptions),
  doc: Type.Optional(DocumentSchema),
  computeSuggestions: Type.Optional(Type.Boolean()),
  references: Type.Optional(Type.Array(ReferenceSchema)),
  workspaceFolder: Type.Optional(Type.String()),
  ignoredSkills: Type.Optional(Type.Array(Type.String())),
  confirmationResponse: ChatConfirmationResponseSchema,
  model: Type.Optional(Type.String()),
});

const handleConversationTurn = addMethodHandlerValidation(Params, handleConversationTurnChecked);

export { handleConversationTurn };
