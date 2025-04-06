import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver';
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

function buildEditConversation(
  editConversationService: EditConversations,
  editConversationId: string,
  params: Static<typeof ContinueEditConversationRequest>
) {
  const editConversation = editConversationService.get(editConversationId);
  const newTurn = new EditTurn({ message: params.message, type: 'user' }, params.workingSet);

  if (params.workspaceFolder) {
    newTurn.workspaceFolder = params.workspaceFolder;
  }

  editConversationService.addTurn(editConversation.id, newTurn);
  return editConversation;
}

async function handleEditConversationTurnChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof ContinueEditConversationRequest>
): Promise<[[], null] | [null, { code: number; message: string }]> {
  if (ctx.get(CopilotEditsMockManager).isMockEnabled()) {
    await streamMockedResult(ctx, params.editConversationId, uuidv4(), params.partialResultToken);
    return [[], null];
  }
  const editConversationService = ctx.get(EditConversations);
  const editConversation = buildEditConversation(editConversationService, params.editConversationId, params);
  const lastTurn = editConversation.getLastTurn();
  const editTurnContext = new EditTurnContext(ctx, editConversation, lastTurn, params.partialResultToken, params.model);
  const mergedToken = ctx.get(ProgressTokens).add(params.partialResultToken, token);
  try {
    return [await ctx.get(CopilotEditsService).createOrContinueEditConversation(editTurnContext, mergedToken), null];
  } catch (error) {
    return ctx.get(CopilotEditsExceptionHandler).handleException(ctx, error, editTurnContext);
  }
}

const ContinueEditConversationRequest = Type.Object({
  partialResultToken: Type.Union([Type.String(), Type.Number()]),
  editConversationId: Type.String(),
  message: Type.String(),
  workingSet: Type.Optional(Type.Array(FileReferenceSchema)),
  workspaceFolder: Type.Optional(Type.String()),
  userLanguage: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
});

const handleEditConversationTurn = ensureAuthenticated(
  addMethodHandlerValidation(ContinueEditConversationRequest, handleEditConversationTurnChecked)
);

export { handleEditConversationTurn };
