import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';
import type { Conversation } from '../../../../lib/src/conversation/conversation.ts';

import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { TurnProcessorFactory } from '../../conversation/turnProcessorFactory.ts';
import { ProgressTokens } from '../../progressTokens.ts';
import { ErrorCode } from '../../rpc.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { getTextDocumentChecked } from '../../textDocument.ts';
import { Conversations } from '../../../../lib/src/conversation/conversations.ts';
import { Turn } from '../../../../lib/src/conversation/conversation.ts';
import { ConversationSkillRegistry } from '../../../../lib/src/conversation/prompt/conversationSkill.ts';
import { ConversationSourceSchema, DocumentSchema, ReferenceSchema } from '../../../../lib/src/conversation/schema.ts';
import { TurnContext } from '../../../../lib/src/conversation/turnContext.ts';
import { Type } from '../../../../node_modules/@sinclair/typebox/build/esm/type/type/index.mjs';

async function handleConversationCreateChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<
  | [{ conversationId: string; turnId: string; agentSlug?: string; modelFamily?: string }, null]
  | [null, { code: number; message: string }]
> {
  let textDocument;
  if (params.doc) {
    const result = await getTextDocumentChecked(ctx, params.doc.uri);
    if (result.status === 'notfound') return [null, { code: ErrorCode.InvalidParams, message: result.message }];
    if (result.status === 'valid') textDocument = result.document;
  }
  if (params.capabilities?.allSkills) {
    params.capabilities.skills = ctx
      .get(ConversationSkillRegistry)
      .getDescriptors()
      .map((s) => s.id);
  }
  const source = params.source ?? 'panel';
  const conversation = await ctx.get(Conversations).create(params.capabilities, source, params.userLanguage);
  await addTurns(ctx, conversation, params);
  const lastTurn = conversation.turns[conversation.turns.length - 1];
  const mergedToken = ctx.get(ProgressTokens).add(params.workDoneToken, token);
  const turnContext = new TurnContext(ctx, conversation, lastTurn, mergedToken);

  await (
    await ctx.get(TurnProcessorFactory).createProcessor(turnContext, params.workDoneToken, params.computeSuggestions)
  ).process(params.workDoneToken, mergedToken, undefined, textDocument, params.model);

  return [
    {
      conversationId: conversation.id,
      turnId: lastTurn.id,
      agentSlug: lastTurn.agent?.agentSlug,
      modelFamily: params.model,
    },
    null,
  ];
}

async function addTurns(ctx: Context, conversation: Conversation, params: Static<typeof Params>): Promise<void> {
  for (const turn of params.turns) {
    const toAdd = new Turn({ message: turn.request, type: 'user' });
    if (turn.response) {
      toAdd.response = { message: turn.response, type: 'model' };
    }

    if (turn.agentSlug) {
      toAdd.agent = { agentSlug: turn.agentSlug };
    }

    await ctx
      .get(Conversations)
      .addTurn(conversation.id, toAdd, params.references, params.workspaceFolder, params.ignoredSkills);
  }
}

const TurnSchema = Type.Object({
  request: Type.String(),
  response: Type.Optional(Type.String()),
  agentSlug: Type.Optional(Type.String()),
});

const Params = Type.Object({
  workDoneToken: Type.Union([Type.String(), Type.Number()]),
  turns: Type.Array(TurnSchema, { minItems: 1 }),
  options: Type.Optional(TestingOptions),
  capabilities: Type.Object({
    allSkills: Type.Optional(Type.Boolean()),
    skills: Type.Array(Type.String()),
  }),
  doc: Type.Optional(DocumentSchema),
  computeSuggestions: Type.Optional(Type.Boolean()),
  references: Type.Optional(Type.Array(ReferenceSchema)),
  source: Type.Optional(ConversationSourceSchema),
  workspaceFolder: Type.Optional(Type.String()),
  ignoredSkills: Type.Optional(Type.Array(Type.String())),
  userLanguage: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
});

const handleConversationCreate = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationCreateChecked)
);

export { handleConversationCreate };
