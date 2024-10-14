import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';
import { type Context } from '../../../../lib/src/context.ts';
import { getTextDocumentChecked } from '../../textDocument.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import { WorkDoneProgressTokens } from '../../workDoneProgressTokens.ts';
import { TurnProcessorFactory } from '../../conversation/turnProcessorFactory.ts';
import { TestingOptions } from '../testingOptions.ts';
import { DocumentSchema, ReferenceSchema } from '../../../../lib/src/conversation/schema.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { Turn } from '../../../../lib/src/conversation/conversation.ts';
import { TurnContext } from '../../../../lib/src/conversation/turnContext.ts';
import { TextDocument } from '../../../../lib/src/textDocument.ts';

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
});

async function handleConversationTurnChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<
  [{ conversationId: string; turnId: string; agentSlug?: string }, null] | [null, { code: number; message: string }]
> {
  let textDocument: TextDocument | undefined;

  if (params.doc) {
    const result = await getTextDocumentChecked(ctx, params.doc.uri);
    if (result.status === 'notfound') return [null, { code: -32602, message: result.message }];
    if (result.status === 'valid') textDocument = result.document;
  }

  const conversations = ctx.get(Conversations);
  const conversation = conversations.get(params.conversationId);
  const turn = await conversations.addTurn(
    conversation.id,
    new Turn({ message: params.message, type: 'user' }),
    params.references,
    params.workspaceFolder,
    params.ignoredSkills
  );
  const mergedToken = ctx.get(WorkDoneProgressTokens).add(params.workDoneToken, token);
  const turnContext = new TurnContext(ctx, conversation, turn, mergedToken);
  const processor = await ctx
    .get(TurnProcessorFactory)
    .createProcessor(turnContext, params.workDoneToken, params.computeSuggestions);
  await processor.process(params.workDoneToken, mergedToken, params.followUp, textDocument);
  return [{ conversationId: conversation.id, turnId: turn.id, agentSlug: turn.agent?.agentSlug }, null];
}

const handleConversationTurn = addMethodHandlerValidation(Params, handleConversationTurnChecked);

export { handleConversationTurn };
