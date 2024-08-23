import { URI, Utils } from 'vscode-uri';

import { Unknown, TelemetryProperties, Model, Chat } from '../../types';
import { CancellationToken } from '../../../../agent/src/cancellation';
import { TextDocument } from '../../textDocument';
import { Turn, Conversation } from '../conversation';
import { TurnContext } from '../turnContext';
import { Response } from '../../networking';
import { TelemetryData } from '../../telemetry';

import { ConversationProgress } from '../conversationProgress';
import { } from '../openai/openai';
import { ConversationFinishCallback } from '../conversationFinishCallback';
import { } from '../../../../prompt/src/tokenization/index';
import { createTelemetryWithId, uiKindToMessageSource, extendUserMessageTelemetryData } from '../telemetry';
import { ChatModelFamily } from '../modelMetadata';
import { ChatFetchResultPostProcessor } from '../fetchPostProcessor';
import { conversationLogger } from '../logger';
import { ChatMLFetcher } from '../chatMLFetcher';
import { CopilotTokenManager } from '../../auth/copilotTokenManager';
import { countMessagesTokens } from '../openai/chatTokens';
import { } from '../../openai/fetch';
import { NetworkConfiguration } from '../../networkConfiguration';
import { StreamCopilotAnnotations } from '../../openai/stream';
import { IPromptTemplate } from '../promptTemplates';

const GENERATE_RESPONSE_STEP = 'generate-response';

class RemoteAgentAuthorizationError extends Error {
  constructor(
    message: string,
    readonly authorizationUri: string,
    readonly agentSlug: string,
    readonly agentName: string
  ) {
    super(message);
  }
}

class RemoteAgentTurnProcessor {
  readonly conversationProgress: ConversationProgress;
  readonly postProcessor: ChatFetchResultPostProcessor;
  readonly conversation: Conversation;
  readonly turn: Turn;
  constructor(
    readonly agent: Unknown.Agent,
    readonly turnContext: TurnContext,
    readonly chatFetcher = new ChatMLFetcher(turnContext.ctx)
  ) {
    this.conversationProgress = turnContext.ctx.get(ConversationProgress);
    this.postProcessor = new ChatFetchResultPostProcessor(turnContext, this.chatFetcher, !1);
    this.conversation = turnContext.conversation;
    this.turn = turnContext.turn;
  }
  async process(
    workDoneToken: Unknown.WorkDoneToken,
    cancellationToken: CancellationToken,
    followUp: Unknown.FollowUp,
    doc: TextDocument
  ): Promise<void> {
    try {
      await this.processWithAgent(workDoneToken, cancellationToken, this.turnContext, doc);
    } catch (err) {
      conversationLogger.error(this.turnContext.ctx, `Error processing turn ${this.turn.id}`, err);
      let errorMessage = (err as any).message;
      this.turn.status = 'error';
      this.turn.response = { message: errorMessage, type: 'meta' };
      if (err instanceof RemoteAgentAuthorizationError) {
        await this.endProgress({
          unauthorized: {
            authorizationUri: err.authorizationUri,
            agentSlug: err.agentSlug,
            agentName: err.agentName,
          },
        });
      } else {
        await this.endProgress({ error: { message: errorMessage, responseIsIncomplete: true } });
      }
    }
  }
  async processWithAgent(
    workDoneToken: Unknown.WorkDoneToken,
    cancellationToken: CancellationToken,
    turnContext: TurnContext,
    doc: TextDocument
  ) {
    await this.conversationProgress.begin(this.conversation, this.turn, workDoneToken);
    const telemetryWithId = createTelemetryWithId(this.turn.id, this.conversation.id);
    if ((telemetryWithId.markAsDisplayed(), cancellationToken.isCancellationRequested)) {
      (this.turn.status = 'cancelled'), await this.cancelProgress();
      return;
    }
    let conversationPrompt = await this.buildAgentPrompt(turnContext);
    if (!conversationPrompt) await this.endTurnWithResponse(`No prompt created for agent ${this.agent.id}`, 'error');
    else {
      await turnContext.steps.start(GENERATE_RESPONSE_STEP, 'Generating response');
      let [telemetryMessageId, augmentedTelemetry] = this.augmentTelemetry(
        conversationPrompt,
        telemetryWithId,
        undefined,
        doc
      );
      if (cancellationToken.isCancellationRequested) {
        (this.turn.status = 'cancelled'), await this.cancelProgress();
        return;
      }
      const response = await this.fetchConversationResponse(
        conversationPrompt.messages,
        cancellationToken,
        augmentedTelemetry,
        doc,
        {
          messageId: telemetryMessageId,
          conversationId: this.conversation.id,
          messageSource: uiKindToMessageSource('conversationPanel'),
        }
      );
      if (this.turn.status === 'cancelled' && this.turn.response?.type === 'user') {
        await this.cancelProgress();
      } else {
        await this.finishGenerateResponseStep(response, turnContext);
        await this.endProgress(
          'error' in response
            ? {
              error: response.error,
              followUp: undefined,
              suggestedTitle: undefined,
              skillResolutions: conversationPrompt.skillResolutions,
            }
            : {
              error: undefined,
              followUp: response.followUp,
              suggestedTitle: response.suggestedTitle,
              skillResolutions: conversationPrompt.skillResolutions,
            }
        );
      }
    }
  }
  async buildAgentPrompt(turnContext: TurnContext) {
    const modelConfiguration = await this.getModelConfiguration();
    const messages: Chat.ChatMessage[] = [{ role: Chat.Role.User, content: turnContext.turn.request.message }];
    return {
      messages: messages,
      tokens: countMessagesTokens(messages, modelConfiguration),
      skillResolutions: [],
    };
  }
  async endTurnWithResponse(response: string, status: Turn['status']) {
    this.turn.response = { type: 'meta', message: response };
    this.turn.status = status;
    await this.conversationProgress.report(this.conversation, this.turn, { reply: response });
    await this.endProgress();
  }
  async fetchConversationResponse(
    messages: Chat.ElidableChatMessage[],
    token: CancellationToken,
    baseUserTelemetry: TelemetryData,
    doc: TextDocument,
    telemetryProperties: TelemetryProperties
  ) {
    token.onCancellationRequested(async () => {
      await this.cancelProgress();
    });
    const finishCallback = new ConversationFinishCallback((text: string, annotations: Unknown.Annotation[]) => {
      this.conversationProgress.report(this.conversation, this.turn, { reply: text, annotations }).then();
      this.turn.response || (this.turn.response = { message: text, type: 'model' });
      this.turn.response.message += text;
      this.turn.annotations.push(...(annotations != null ? annotations : []));
    });
    const modelConfiguration = await this.getModelConfiguration();
    const capiUrl = this.turnContext.ctx.get(NetworkConfiguration).getCAPIUrl(this.turnContext.ctx);
    const authToken = await this.turnContext.ctx.get(CopilotTokenManager).getGitHubToken(this.turnContext.ctx);
    const params: ChatMLFetcher.Params = {
      modelConfiguration: modelConfiguration,
      engineUrl: Utils.joinPath(URI.parse(capiUrl), '/agents').toString(),
      endpoint: this.agent.slug,
      messages,
      uiKind: 'conversationPanel',
      intentParams: { intent: !0, intent_threshold: 0.9, intent_content: this.turn.request.message },
      telemetryProperties: telemetryProperties,
      authToken: authToken,
    };
    const fetchResult = await this.chatFetcher.fetchResponse(
      params,
      token,
      async (text: string, annotations?: StreamCopilotAnnotations) => {
        finishCallback.isFinishedAfter(text, annotations);
        return undefined;
      }
    );
    this.ensureAgentIsAuthorized(fetchResult);
    return await this.postProcessor.postProcess(
      fetchResult,
      token,
      finishCallback.appliedText,
      baseUserTelemetry,
      this.turn.request.message,
      'conversationPanel',
      doc
    );
  }
  async getModelConfiguration(): Promise<Model.Configuration> {
    return {
      modelId: this.agent.slug,
      uiName: this.agent.name,
      modelFamily: ChatModelFamily.Unknown,
      maxTokens: -1,
      maxRequestTokens: -1,
      maxResponseTokens: -1,
      baseTokensPerMessage: 3,
      baseTokensPerName: 1,
      baseTokensPerCompletion: 3,
      tokenizer: 'cl100k_base',
      isExperimental: false,
    };
  }
  ensureAgentIsAuthorized(fetchResult: ChatMLFetcher.Response) {
    if (fetchResult.type === 'agentAuthRequired') {
      this.turnContext.turn.status = 'error';
      this.turnContext.turn.response = { message: 'Authorization required', type: 'server' };
      throw new RemoteAgentAuthorizationError(
        'Authorization required',
        fetchResult.authUrl,
        this.agent.slug,
        this.agent.name
      );
    }
  }
  augmentTelemetry(
    conversationPrompt: Unknown.ConversationPrompt,
    userTelemetry: TelemetryData,
    template?: IPromptTemplate,
    doc?: TextDocument
  ): [string, TelemetryData] {
    let augmentedTelemetry = extendUserMessageTelemetryData(
      this.conversation,
      'conversationPanel',
      this.turn.request.message.length,
      conversationPrompt.tokens,
      template?.id,
      undefined,
      userTelemetry,
      conversationPrompt.skillResolutions
    );
    return [augmentedTelemetry.properties.messageId as string, augmentedTelemetry];
  }
  async finishGenerateResponseStep(response: unknown, turnContext: TurnContext) {
    const error = (response as any).error; // MARK
    error
      ? await turnContext.steps.error(GENERATE_RESPONSE_STEP, error.message)
      : await turnContext.steps.finish(GENERATE_RESPONSE_STEP);
  }
  async endProgress(payload?: unknown) {
    await this.turnContext.steps.finishAll();
    await this.conversationProgress.end(this.conversation, this.turn, payload);
  }
  async cancelProgress() {
    await this.turnContext.steps.finishAll('cancelled');
    await this.conversationProgress.cancel(this.conversation, this.turn);
  }
}

export { RemoteAgentTurnProcessor };
