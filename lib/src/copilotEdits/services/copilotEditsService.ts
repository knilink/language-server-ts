import type { CancellationToken } from 'vscode-languageserver';
import type { Context } from '../../context.ts';
import type { EditTurnContext } from '../resources/editTurnContext.ts';

import { EditConversations } from './editConversations.ts';
import { CodeMapper } from '../codeMapper/codeMapper.ts';
import { CopilotEditsCancelledByUserException } from '../exceptions/cancelledByUserException.ts';
import { FailedToEditCodeException } from '../exceptions/failedToEditCodeException.ts';
import { NotSupportedEditCodeResponseTypeException } from '../exceptions/notSupportedEditCodeResponseTypeException.ts';
import { EditProgressReporter } from '../progress/editProgressReporter.ts';
import { stringToAsyncIterable } from '../prompts/asyncIterableUtils.ts';
import { EditCodePrompt } from '../prompts/editCode/editCodePrompt.ts';
import { CopilotEditsPromptUriUtils } from '../prompts/promptUriUtils.ts';
import { DefaultTextDocumentProvider } from '../prompts/textDocumentProvider.ts';
import { getCodeBlocksFromResponse } from '../responseParser/editCodeResponseParser.ts';
import { ChatMLFetcher } from '../../conversation/chatMLFetcher.ts';
import { ModelConfigurationProvider } from '../../conversation/modelConfigurations.ts';
import { Features } from '../../experiments/features.ts';
import type {} from '../../conversation/modelMetadata.ts';
import type {} from '../resources/editConversation.ts';
import type {} from '../../openai/fetch.ts';
import type {} from '../../../../types/src/index.ts';

class CopilotEditsService {
  constructor(
    readonly ctx: Context,
    readonly chatFetcher = new ChatMLFetcher(ctx)
  ) {}

  async createOrContinueEditConversation(editTurnContext: EditTurnContext, token: CancellationToken): Promise<[]> {
    const editCodeResultValue = await this.getEditCodeResultValue(editTurnContext, token);
    await this.parseAndSendProgressBack(editTurnContext, editCodeResultValue, token);
    return [];
  }

  async getEditCodeResultValue(editTurnContext: EditTurnContext, token: CancellationToken) {
    await this.abortIfCancelled(editTurnContext, token);
    const promptMessages = await this.buildEditCodePromptMessages(editTurnContext);
    await this.abortIfCancelled(editTurnContext, token);
    const telemetryWithExp = await this.ctx.get(Features).updateExPValuesAndAssignments();
    const modelConfiguration = await this.ctx.get(ModelConfigurationProvider).getBestChatModelConfig(['gpt-4o']);

    const result = await this.chatFetcher.fetchResponse(
      {
        modelConfiguration,
        messages: promptMessages,
        uiKind: 'editsPanel',
        intentParams: { intent: true },
        temperature: 0.1,
      },
      token,
      telemetryWithExp
    );

    if (result.type === 'success') {
      return result.value;
    }
    throw result.type !== 'tool_calls' && result.type != 'successMultiple'
      ? new FailedToEditCodeException(
          `Failed to edit code with result type: ${result.type} and reason: ${result.reason}`
        )
      : new NotSupportedEditCodeResponseTypeException(`Not supported ChatFetchResult type ${result.type}.`);
  }

  async buildEditCodePromptMessages(editTurnContext: EditTurnContext) {
    const currentTurn = editTurnContext.currentTurn;
    return await new EditCodePrompt({
      userMessage: currentTurn.request.message,
      workspaceFolder: currentTurn.workspaceFolder || '',
      workingSet: currentTurn.workingSet,
      userLanguage: editTurnContext.editConversation.getUserLanguage(),
      textDocumentProvider: new DefaultTextDocumentProvider(this.ctx),
    }).render();
  }

  async abortIfCancelled(editTurnContext: EditTurnContext, token: CancellationToken) {
    if (token.isCancellationRequested) {
      editTurnContext.currentTurn.status = 'cancelled';
      throw new CopilotEditsCancelledByUserException();
    }
    this.ctx.get(EditConversations).get(editTurnContext.editConversationId);
  }

  async parseAndSendProgressBack(
    editTurnContext: EditTurnContext,
    editCodeResultValue: string,
    token: CancellationToken
  ) {
    const textStream = stringToAsyncIterable(editCodeResultValue);
    const codeMapper = new CodeMapper(this.ctx);
    const createUri = async (path: string) => CopilotEditsPromptUriUtils.pathToUri(editTurnContext, path);
    const mapCodeTasks = [];
    for await (const codeBlock of getCodeBlocksFromResponse(textStream, createUri))
      await this.abortIfCancelled(editTurnContext, token),
        mapCodeTasks.push(codeMapper.mapCode(codeBlock, editTurnContext, token));
    await Promise.all(mapCodeTasks);

    if (mapCodeTasks.length === 0) {
      await this.reportNoCodeBlocks(editTurnContext, editCodeResultValue);
    }

    editTurnContext.currentTurn.status = 'success';
  }
  async reportNoCodeBlocks(editTurnContext: EditTurnContext, rawResponse: string) {
    await this.ctx
      .get(EditProgressReporter)
      .reportTurn(editTurnContext, { fileGenerationStatus: 'no-code-blocks-found', rawResponse });
  }
}

export { CopilotEditsService };
