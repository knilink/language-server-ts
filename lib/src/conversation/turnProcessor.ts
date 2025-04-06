import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { IPromptTemplate } from './promptTemplates.ts';
import type { TurnContext } from './turnContext.ts';
import type { Chat, SkillId, UiKind, Unknown } from '../types.ts';
import type { CopilotTextDocument } from '../textDocument.ts';
import type { ITurnProcessorStrategy } from './turnProcessorStrategy.ts';
import type { TelemetryWithExp } from '../telemetry.ts';
import type { ITurnProcessor } from '../../../agent/src/conversation/turnProcessorFactory.ts';

import { getAgents } from './agents/agents.ts';
import { ChatMLFetcher } from './chatMLFetcher.ts';
import { markdownCommentRegexp } from './codeEdits.ts';
import { ConversationFinishCallback } from './conversationFinishCallback.ts';
import { ConversationProgress } from './conversationProgress.ts';
import { ChatFetchResultPostProcessor } from './fetchPostProcessor.ts';
import { conversationLogger } from './logger.ts';
import { ModelConfigurationProvider } from './modelConfigurations.ts';
import { getSupportedModelFamiliesForPrompt, parseModel } from './modelMetadata.ts';
import { ConversationContextCollector } from './prompt/conversationContextCollector.ts';
import { getPromptTemplates } from './promptTemplates.ts';
import {
  createSuggestionMessageTelemetryData,
  createTelemetryWithExpWithId,
  extendUserMessageTelemetryData,
} from './telemetry.ts';
import type {} from './openai/openai.ts';
import { RemoteAgentTurnProcessor } from './extensibility/remoteAgentTurnProcessor.ts';

export const COLLECT_CONTEXT_STEP = 'collect-context';
export const GENERATE_RESPONSE_STEP = 'generate-response';

export class ModelTurnProcessor implements ITurnProcessor {
  conversationProgress: ConversationProgress;
  chatFetcher: ChatMLFetcher;
  postProcessor: ChatFetchResultPostProcessor;
  conversation: TurnContext['conversation'];
  turn: TurnContext['turn'];

  constructor(
    readonly turnContext: TurnContext,
    readonly strategy: ITurnProcessorStrategy,
    chatFetcher?: ChatMLFetcher
  ) {
    this.conversationProgress = turnContext.ctx.get(ConversationProgress);
    this.chatFetcher = chatFetcher || new ChatMLFetcher(turnContext.ctx);
    this.postProcessor = new ChatFetchResultPostProcessor(turnContext, this.chatFetcher, strategy.computeSuggestions);
    this.conversation = turnContext.conversation;
    this.turn = turnContext.turn;
  }

  public async process(
    workDoneToken: string,
    cancellationToken: CancellationToken,
    followUp?: Unknown.FollowUp,
    doc?: CopilotTextDocument,
    model?: string
  ): Promise<void> {
    try {
      await this.processWithModel(workDoneToken, cancellationToken, this.turnContext, followUp, doc, model);
    } catch (err: any) {
      conversationLogger.error(this.turnContext.ctx, `Error processing turn ${this.turn.id} `, err);
      let errorMessage = err instanceof Error ? err.message : String(err);
      this.turn.status = 'error';
      this.turn.response = { message: errorMessage, type: 'meta' };
      await this.endProgress({ error: { message: errorMessage, responseIsIncomplete: true } });
    }
  }

  async processWithModel(
    workDoneToken: string,
    cancellationToken: CancellationToken,
    turnContext: TurnContext,
    followUp?: Unknown.FollowUp,
    doc?: CopilotTextDocument,
    model?: string
  ): Promise<void> {
    await this.conversationProgress.begin(this.conversation, this.turn, workDoneToken);
    const telemetryWithExp = await createTelemetryWithExpWithId(
      this.turnContext.ctx,
      this.turn.id,
      this.conversation.id,
      { languageId: doc?.languageId ?? '' }
    );

    if (cancellationToken.isCancellationRequested) {
      this.turn.status = 'cancelled';
      await this.cancelProgress();
      return;
    }

    const template = getPromptTemplates().find((t) => t.id === this.turn.template?.templateId);
    if (this.turn.template && template && template.response) {
      await this.handleTemplateResponse(template, this.turn.template.userQuestion, cancellationToken); // t.id === this.turn.template?.templateId above suggested this.turn.template isn't undefined
      return;
    }

    const agent = (await getAgents(this.turnContext.ctx)).find((a) => a.slug === (this.turn.agent?.agentSlug || null));
    if (agent) {
      const failedConditions = await this.checkAgentPreconditions(agent);
      if (failedConditions) {
        await this.endProgress(failedConditions);
        return;
      }
    }

    await turnContext.steps.start(COLLECT_CONTEXT_STEP, 'Collecting context');
    await this.collectContext(turnContext, cancellationToken, telemetryWithExp, this.strategy.uiKind, template, agent);

    const modelNameArg = model
      ? (await this.turnContext.ctx.get(ModelConfigurationProvider).getBestChatModelConfig(parseModel(model))).uiName
      : undefined;

    const conversationPrompt = await this.strategy.buildConversationPrompt(
      turnContext,
      doc?.languageId ?? '',
      undefined,
      modelNameArg
    );

    if (!conversationPrompt) {
      await turnContext.steps.error(COLLECT_CONTEXT_STEP, 'Failed to collect context');
      await this.endTurnWithResponse(this.strategy.earlyReturnResponse, 'error');
    } else {
      await turnContext.steps.finish(COLLECT_CONTEXT_STEP);
      await turnContext.steps.start(GENERATE_RESPONSE_STEP, 'Generating response');
      const augmentedTelemetryWithExp = this.augmentTelemetry(
        conversationPrompt,
        telemetryWithExp,
        template,
        followUp,
        doc
      );
      if (cancellationToken.isCancellationRequested) {
        this.turn.status = 'cancelled';
        await this.cancelProgress();
        return;
      }

      const response = await this.fetchConversationResponse(
        conversationPrompt.messages,
        cancellationToken,
        telemetryWithExp.extendedBy({ messageSource: 'chat.user' }, { promptTokenLen: conversationPrompt.tokens }),
        augmentedTelemetryWithExp,
        doc
      );

      const updatedDocuments = await this.strategy.processResponse(this.turn);
      if (this.turn.status === 'cancelled' && this.turn.response?.type === 'user') {
        await this.cancelProgress();
      } else {
        await this.finishGenerateResponseStep(response, turnContext);
        await this.endProgress({
          ...('error' in response
            ? { error: response.error, followUp: undefined, suggestedTitle: undefined }
            : { error: undefined, followUp: response.followup, suggestedTitle: response.suggestedTitle }),
          skillResolutions: conversationPrompt.skillResolutions,
          updatedDocuments: updatedDocuments,
        });
      }
    }
  }

  async checkAgentPreconditions(agent: any): Promise<any> {
    try {
      const preconditions = agent.checkPreconditions
        ? await agent.checkPreconditions(this.turnContext.ctx, this.turn)
        : undefined;
      if (preconditions && preconditions.type === 'authorizationRequired') {
        return { unauthorized: { ...preconditions, agentName: agent.name, agentSlug: agent.slug } };
      }
    } catch (err: any) {
      conversationLogger.error(this.turnContext.ctx, `Error checking preconditions for agent ${agent.slug}`, err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.turn.status = 'error';
      this.turn.response = { message: errorMessage, type: 'meta' };
      return { error: { message: errorMessage, responseIsIncomplete: true } };
    }
  }

  async endTurnWithResponse(response: string, status: 'error'): Promise<void> {
    this.turn.response = { type: 'meta', message: response };
    this.turn.status = status;
    await this.conversationProgress.report(this.conversation, this.turn, { reply: response });
    await this.endProgress();
  }

  async handleTemplateResponse(
    template: IPromptTemplate,
    userQuestion: string,
    cancellation: CancellationToken
  ): Promise<void> {
    if (!template.response) return;
    const response = await template.response(this.turnContext, userQuestion, cancellation);
    this.turn.response = { type: 'meta', message: response.message };
    const error: any = response.error;
    this.turn.status = error?.responseIsFiltered ? 'filtered' : error?.responseIsIncomplete ? 'error' : 'success';

    if (error?.responseIsFiltered || error?.responseIsIncomplete) {
      await this.conversationProgress.report(this.conversation, this.turn, {
        reply: 'Sure, I can definitely do that!',
        annotations: response.annotations,
        notifications: response.notifications,
        references: response.references,
      });
      await this.turnContext.steps.finishAll();
      await this.endProgress({
        error: {
          message: response.message,
          code: error?.code || 0,
          responseIsIncomplete: error?.responseIsIncomplete,
          responseIsFiltered: error?.responseIsFiltered,
        },
      });
    } else {
      await this.conversationProgress.report(this.conversation, this.turn, {
        reply: response.message,
        annotations: response.annotations,
        notifications: response.notifications,
        references: response.references,
        confirmationRequest: response.confirmationRequest,
      });
      await this.endProgress();
    }
  }

  async collectContext(
    turnContext: TurnContext,
    cancellationToken: CancellationToken,
    baseTelemetryWithExp: TelemetryWithExp,
    uiKind: UiKind,
    template?: IPromptTemplate,
    agent?: ConversationContextCollector.Agent
  ): Promise<{ skillIds: SkillId[] }> {
    const promptContext = await new ConversationContextCollector(this.turnContext.ctx, this.chatFetcher).collectContext(
      turnContext,
      cancellationToken,
      baseTelemetryWithExp,
      uiKind,
      template,
      agent
    );
    this.turn.skills = promptContext.skillIds.map((skill) => ({ skillId: skill }));
    return promptContext;
  }

  async fetchConversationResponse(
    messages: Chat.ChatMessage[],
    token: CancellationToken,
    baseTelemetryWithExp: TelemetryWithExp,
    augmentedTelemetryWithExp: TelemetryWithExp,
    doc?: CopilotTextDocument,
    model?: string
  ): Promise<ChatFetchResultPostProcessor.PostProcessResult> {
    token.onCancellationRequested(async () => {
      await this.cancelProgress();
    });

    let partialResponse = '';
    let numCodeEdits = 0;
    const finishCallback = new ConversationFinishCallback((text, annotations, references, errors) => {
      const hasEditComment = text.trim().match(markdownCommentRegexp) !== null;
      this.conversationProgress.report(this.conversation, this.turn, {
        reply: text,
        annotations,
        references,
        hideText: hasEditComment,
        notifications: errors.map((e) => ({ severity: 'warning', message: (e as any).message })),
      });

      if (this.turn.response) {
        this.turn.response.message += text;
      } else {
        this.turn.response = { message: text, type: 'model' };
      }

      this.turn.annotations.push(...(annotations != null ? annotations : []));
      partialResponse += text;
      if (this.strategy.currentDocument) {
        const codeEdits = this.strategy.extractEditsFromResponse(partialResponse, this.strategy.currentDocument);

        if (codeEdits?.length > 0) {
          partialResponse = '';
          this.conversationProgress.report(this.conversation, this.turn, { codeEdits });
          numCodeEdits += codeEdits.length;
        }
      }
    });

    const modelConfiguration = await this.turnContext.ctx
      .get(ModelConfigurationProvider)
      .getBestChatModelConfig(model ? parseModel(model) : getSupportedModelFamiliesForPrompt('user'));

    if (modelConfiguration.modelFamily === 'o1-ga' || modelConfiguration.modelFamily === 'o1-mini') {
      messages = messages.map<Chat.ChatMessage>((message): Chat.ChatMessage => {
        if (message.role !== 'user') {
          return { role: 'user', content: message.content };
        }
        return message;
      });
    }

    const params = {
      modelConfiguration,
      messages,
      uiKind: this.strategy.uiKind,
      intentParams: { intent: true, intent_threshold: 0.7, intent_content: this.turn.request.message },
    };

    const fetchResult = await this.chatFetcher.fetchResponse(params, token, baseTelemetryWithExp, async (text, delta) =>
      finishCallback.isFinishedAfter(text, delta)
    );
    augmentedTelemetryWithExp = augmentedTelemetryWithExp.extendedBy(undefined, { numCodeEdits });
    return await this.postProcessor.postProcess(
      fetchResult,
      token,
      finishCallback.appliedText,
      baseTelemetryWithExp,
      augmentedTelemetryWithExp,
      this.turn.request.message,
      this.strategy.uiKind,
      doc
    );
  }

  augmentTelemetry(
    conversationPrompt: Unknown.ConversationPrompt,
    baseTelemetryWithExp: TelemetryWithExp,
    template?: IPromptTemplate,
    followUp?: Unknown.FollowUp,
    doc?: CopilotTextDocument
  ): TelemetryWithExp {
    let augmentedTelemetry: TelemetryWithExp;

    if (followUp) {
      this.turn.request.type = 'follow-up';
      createSuggestionMessageTelemetryData(
        this.turnContext.ctx,
        this.conversation,
        this.strategy.uiKind,
        this.turn.request.message,
        conversationPrompt.tokens,
        followUp.type,
        followUp.id,
        doc,
        baseTelemetryWithExp
      );
      augmentedTelemetry = extendUserMessageTelemetryData(
        this.conversation,
        this.strategy.uiKind,
        this.turn.request.message.length,
        conversationPrompt.tokens,
        followUp.type,
        followUp.id,
        baseTelemetryWithExp,
        conversationPrompt.skillResolutions
      );
    } else {
      augmentedTelemetry = extendUserMessageTelemetryData(
        this.conversation,
        this.strategy.uiKind,
        this.turn.request.message.length,
        conversationPrompt.tokens,
        template?.id || undefined,
        undefined,
        baseTelemetryWithExp,
        conversationPrompt.skillResolutions
      );
    }

    return augmentedTelemetry;
  }

  async finishGenerateResponseStep(
    response: ChatFetchResultPostProcessor.PostProcessResult,
    turnContext: TurnContext
  ): Promise<void> {
    if ('error' in response) {
      await turnContext.steps.error(GENERATE_RESPONSE_STEP, response.error.message);
    } else {
      await turnContext.steps.finish(GENERATE_RESPONSE_STEP);
    }
  }

  async endProgress(payload?: any): Promise<void> {
    await this.turnContext.steps.finishAll();
    await this.conversationProgress.end(this.conversation, this.turn, payload);
  }

  async cancelProgress(): Promise<void> {
    await this.turnContext.steps.finishAll('cancelled');
    await this.conversationProgress.cancel(this.conversation, this.turn);
  }
}

export default ModelTurnProcessor;
