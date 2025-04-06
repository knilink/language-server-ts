import type { LanguageId, UiKind, Unknown } from '../types.ts';
import type { Context } from '../context.ts';
import type { PromptOptions } from './prompt/strategies/types.ts';
import type { CodeEdit } from './codeEdits.ts';
import type { CopilotTextDocument } from '../textDocument.ts';
import type { TurnContext } from './turnContext.ts';
import type { IPromptTemplate } from './promptTemplates.ts';
import { CurrentEditorSkill } from './skills/CurrentEditorSkill.ts';

import { applyEditsToDocument, codeEditModes, extractEditsFromTaggedCodeblocks } from './codeEdits.ts';
import { ConversationInspector } from './conversationInspector.ts';
import { ModelConfigurationProvider } from './modelConfigurations.ts';
import { getSupportedModelFamiliesForPrompt } from './modelMetadata.ts';
import { ConversationPromptEngine } from './prompt/conversationPromptEngine.ts';
import { CurrentEditorSkillId } from './skills/CurrentEditorSkill.ts';
import { FileReader } from '../fileReader.ts';
import type {} from '../openai/fetch.ts';

type Document = {
  uri: string;
  text: string;
};

interface ITurnProcessorStrategy {
  earlyReturnResponse: string;
  uiKind: UiKind;
  computeSuggestions: boolean;
  currentDocument?: CopilotTextDocument;
  processResponse(turn: { response?: { message?: string }; status: string }): Promise<Document[]>;
  buildConversationPrompt(
    turnContext: TurnContext,
    languageId: LanguageId,
    // optional ./turnProcessor.ts
    template?: IPromptTemplate,
    // optional ./turnProcessor.ts
    userSelectedModelName?: string
  ): Promise<Unknown.ConversationPrompt | undefined>;
  extractEditsFromResponse(response: string, doc: CopilotTextDocument): CodeEdit[];
}

class PanelTurnProcessorStrategy implements ITurnProcessorStrategy {
  readonly earlyReturnResponse = 'Oops, an error has occurred. Please try again';
  readonly uiKind: UiKind = 'conversationPanel';
  computeSuggestions = true;

  constructor(readonly ctx: Context) {}

  async processResponse(): Promise<Document[]> {
    return [];
  }

  async buildConversationPrompt(
    turnContext: TurnContext,
    languageId: LanguageId,
    template?: IPromptTemplate,
    userSelectedModelName?: string
  ): Promise<Unknown.ConversationPrompt> {
    const promptType: 'user' = 'user';
    const modelConfiguration = await turnContext.ctx
      .get(ModelConfigurationProvider)
      .getBestChatModelConfig(getSupportedModelFamiliesForPrompt(promptType));
    const promptOptions: PromptOptions = {
      promptType,
      modelConfiguration,
      languageId,
      userSelectedModelName,
    };
    return await this.ctx.get(ConversationPromptEngine).toPrompt(turnContext, promptOptions);
  }

  extractEditsFromResponse(response: string, doc: CopilotTextDocument): CodeEdit[] {
    return [];
  }
}

class InlineTurnProcessorStrategy implements ITurnProcessorStrategy {
  readonly earlyReturnResponse = 'Please open a file and select code for the inline chat to be available';
  readonly uiKind: UiKind = 'conversationInline';
  computeSuggestions = false;
  currentDocument?: CopilotTextDocument;

  constructor(readonly ctx: Context) {}

  async buildConversationPrompt(
    turnContext: TurnContext,
    languageId: string,
    template?: IPromptTemplate
  ): Promise<Unknown.ConversationPrompt | undefined> {
    const currentEditor = await this.getCurrentEditorSkill(turnContext);
    if (!currentEditor) return;

    const currentDocument = await this.getDocumentIfValid(currentEditor.uri);
    if (!currentDocument) return;

    const promptType: 'user' | 'inline' = template?.producesCodeEdits === false ? 'user' : 'inline';
    const modelConfiguration = await turnContext.ctx
      .get(ModelConfigurationProvider)
      .getBestChatModelConfig(getSupportedModelFamiliesForPrompt(promptType));
    const promptOptions = { promptType, modelConfiguration, languageId };

    if (promptOptions.promptType === 'inline') this.currentDocument = currentDocument;
    return await this.ctx.get(ConversationPromptEngine).toPrompt(turnContext, promptOptions);
  }

  async processResponse(turn: { response?: { message?: string }; status: string }): Promise<Document[]> {
    const responseText = turn.response?.message;

    if (responseText && turn.status === 'success' && this.currentDocument) {
      const updatedDocument = await this.processInlineResponse(responseText, this.currentDocument);
      if (updatedDocument) return [updatedDocument];
    }

    return [];
  }

  async getCurrentEditorSkill(turnContext: TurnContext): Promise<CurrentEditorSkill.Skill | undefined> {
    return turnContext.skillResolver.resolve(CurrentEditorSkillId);
  }

  async getDocumentIfValid(uri: string): Promise<CopilotTextDocument | undefined> {
    const documentResult = await this.ctx.get(FileReader).readFile(uri);
    if (documentResult.status === 'valid') return documentResult.document;
  }

  async processInlineResponse(
    responseText: string,
    currentDocument: CopilotTextDocument
  ): Promise<Document | undefined> {
    const filteredEdits = extractEditsFromTaggedCodeblocks(responseText, currentDocument).filter((edit) =>
      codeEditModes.includes(edit.mode)
    );
    const updatedDocumentText = applyEditsToDocument(filteredEdits, currentDocument);

    if (updatedDocumentText) {
      await this.ctx
        .get(ConversationInspector)
        .documentDiff({ original: currentDocument.getText(), updated: updatedDocumentText });
      return { uri: currentDocument.uri, text: updatedDocumentText };
    }
  }

  extractEditsFromResponse(response: string, doc: CopilotTextDocument): CodeEdit[] {
    return extractEditsFromTaggedCodeblocks(response, doc);
  }
}

export { PanelTurnProcessorStrategy, InlineTurnProcessorStrategy, ITurnProcessorStrategy };
