import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';

import { CopilotEditsMockManager } from '../testing/setCopilotEditsResponse.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { CopilotEditsExceptionHandler } from '../../copilotEdits/exceptionHandler.ts';
import { streamMockedResult } from '../../copilotEdits/mockedEditConversation.ts';
import { ProgressTokens } from '../../progressTokens.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { FileReferenceSchema } from '../../../../lib/src/conversation/schema.ts';
import { EditTurn } from '../../../../lib/src/copilotEdits/resources/editConversation.ts';
import { EditTurnContext } from '../../../../lib/src/copilotEdits/resources/editTurnContext.ts';
import { CopilotEditsService } from '../../../../lib/src/copilotEdits/services/copilotEditsService.ts';
import { EditConversations } from '../../../../lib/src/copilotEdits/services/editConversations.ts';
import { Type } from '@sinclair/typebox';
import { v4 as uuidv4 } from 'uuid';

function buildEditConversation(editConversations: EditConversations, params: CreateEditConversationRequestType) {
  const editConversation = editConversations.create(params.source, params.userLanguage);
  for (const turn of params.turns) {
    const editTurn = new EditTurn({ message: turn.request, type: 'user' }, params.workingSet);

    if (turn.response) {
      editTurn.response = { message: turn.response, type: 'model' };
    }

    if (params.workspaceFolder) {
      editTurn.workspaceFolder = params.workspaceFolder;
    }

    editConversations.addTurn(editConversation.id, editTurn);
  }
  return editConversation;
}

async function handleEditConversationCreateChecked(
  ctx: Context,
  token: CancellationToken,
  params: CreateEditConversationRequestType
): Promise<[[], null] | [null, { code: number; message: string }]> {
  if (ctx.get(CopilotEditsMockManager).isMockEnabled()) {
    await streamMockedResult(ctx, uuidv4(), uuidv4(), params.partialResultToken);
    return [[], null];
  }
  const editConversation = buildEditConversation(ctx.get(EditConversations), params);
  const lastTurn = editConversation.getLastTurn();
  const editTurnContext = new EditTurnContext(ctx, editConversation, lastTurn, params.partialResultToken, params.model);
  const mergedToken = ctx.get(ProgressTokens).add(params.partialResultToken, token);
  try {
    return [await ctx.get(CopilotEditsService).createOrContinueEditConversation(editTurnContext, mergedToken), null];
  } catch (error) {
    return ctx.get(CopilotEditsExceptionHandler).handleException(ctx, error, editTurnContext);
  }
}

const EditTurnSchema = Type.Object({ request: Type.String(), response: Type.Optional(Type.String()) });
type EditTurnSchemaType = Static<typeof EditTurnSchema>;

const EditConversationSourceSchema = Type.Union([Type.Literal('panel')]);
type EditConversationSourceSchemaType = Static<typeof EditConversationSourceSchema>;

const CreateEditConversationRequest = Type.Object({
  partialResultToken: Type.Union([Type.String(), Type.Number()]),
  turns: Type.Array(EditTurnSchema, { minItems: 1 }),
  workingSet: Type.Optional(Type.Array(FileReferenceSchema)),
  source: Type.Optional(EditConversationSourceSchema),
  workspaceFolder: Type.Optional(Type.String()),
  userLanguage: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
});
type CreateEditConversationRequestType = Static<typeof CreateEditConversationRequest>;

const handleEditConversationCreate = ensureAuthenticated(
  addMethodHandlerValidation(CreateEditConversationRequest, handleEditConversationCreateChecked)
);

export { handleEditConversationCreate };
