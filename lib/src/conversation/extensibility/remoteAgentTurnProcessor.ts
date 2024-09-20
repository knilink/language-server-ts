import { Unknown, Model, Chat, ConversationReference } from '../../types.ts';
import { CancellationToken } from '../../../../agent/src/cancellation.ts';
import { TextDocument } from '../../textDocument.ts';
import { Turn, Conversation, Reference } from '../conversation.ts';
import { TurnContext } from '../turnContext.ts';
import { TelemetryWithExp } from '../../telemetry.ts';

import { ChatRole } from '../openai/openai.ts';
import {} from '../../../../prompt/src/tokenization/index.ts';
import {} from '../../openai/fetch.ts';
import { IPromptTemplate } from '../promptTemplates.ts';
import { ChatModelFamily } from '../modelMetadata.ts';

import { convertToCopilotReferences } from './references.ts';
import { skillsToReference } from './skillToReferenceAdapters.ts';
import { ChatMLFetcher } from '../chatMLFetcher.ts';
import { ConversationFinishCallback } from '../conversationFinishCallback.ts';
import { ConversationInspector } from '../conversationInspector.ts';
import { ConversationProgress } from '../conversationProgress.ts';
import { ChatFetchResultPostProcessor } from '../fetchPostProcessor.ts';
import { conversationLogger } from '../logger.ts';
import { countMessagesTokens } from '../openai/chatTokens.ts';
import { createTelemetryWithExpWithId, extendUserMessageTelemetryData } from '../telemetry.ts';
import { CopilotTokenManager } from '../../auth/copilotTokenManager.ts';
import { NetworkConfiguration } from '../../networkConfiguration.ts';

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
    const telemetryWithExp = await createTelemetryWithExpWithId(
      this.turnContext.ctx,
      this.turn.id,
      this.conversation.id,
      { languageId: doc?.languageId ?? '' }
    );
    if (cancellationToken.isCancellationRequested) {
      (this.turn.status = 'cancelled'), await this.cancelProgress();
      return;
    }
    let conversationPrompt = await this.buildAgentPrompt(turnContext);
    if (!conversationPrompt) await this.endTurnWithResponse(`No prompt created for agent ${this.agent.id}`, 'error');
    else {
      const promptInspection = {
        type: 'user' as 'user',
        prompt: JSON.stringify(conversationPrompt.messages, null, 2),
        tokens: conversationPrompt.tokens,
      };
      await turnContext.ctx.get(ConversationInspector).inspectPrompt(promptInspection);
      await turnContext.steps.start(GENERATE_RESPONSE_STEP, 'Generating response');
      const augmentedTelemetryWithExp = this.augmentTelemetry(conversationPrompt, telemetryWithExp, undefined, doc);
      if (cancellationToken.isCancellationRequested) {
        (this.turn.status = 'cancelled'), await this.cancelProgress();
        return;
      }
      const response = await this.fetchConversationResponse(
        conversationPrompt.messages,
        cancellationToken,
        telemetryWithExp.extendedBy({ messageSource: 'chat.user' }, { promptTokenLen: conversationPrompt.tokens }),
        augmentedTelemetryWithExp,
        doc
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
    const messages = this.createMessagesFromHistory(turnContext);
    const outgoingReferences = await this.computeCopilotReferences(turnContext);
    messages.push({
      role: ChatRole.User,
      content: turnContext.turn.request.message,
      copilot_references: outgoingReferences.length > 0 ? outgoingReferences : undefined,
    });

    return {
      messages,
      tokens: countMessagesTokens(messages, modelConfiguration),
      skillResolutions: [],
    };
  }
  createMessagesFromHistory(turnContext: TurnContext): Chat.ChatMessage[] {
    return turnContext.conversation.turns
      .filter((t) => {
        return t.id !== turnContext.turn.id && t.agent?.agentSlug === this.agent.slug;
      })
      .flatMap((turn) => {
        let messages: Chat.ChatMessage[] = [];

        if (turn.request) {
          messages.push({ role: ChatRole.User, content: turn.request.message });
        }

        if (turn.response && turn.response.type === 'model') {
          const references = convertToCopilotReferences(turn.response.references);
          messages.push({
            role: ChatRole.Assistant,
            content: turn.response.message,
            copilot_references: references.length > 0 ? references : undefined,
          });
        }
        return messages;
      });
  }
  async computeCopilotReferences(turnContext: TurnContext): Promise<ConversationReference.OutgoingReference[]> {
    return await skillsToReference(turnContext);
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
    baseTelemetryWithExp: TelemetryWithExp,
    augmentedTelemetryWithExp: TelemetryWithExp,
    doc: TextDocument
  ) {
    token.onCancellationRequested(async () => {
      await this.cancelProgress();
    });
    const finishCallback = new ConversationFinishCallback(
      (text: string, annotations: Unknown.Annotation[], references: Reference[], errors: unknown[]) => {
        this.conversationProgress
          .report(this.conversation, this.turn, {
            reply: text,
            annotations: annotations,
            references,
            warnings: errors,
          })
          .then();

        if (this.turn.response) {
          this.turn.response.message += text;
          this.turn.response.references!.push(...references);
        } else {
          this.turn.response = { message: text, type: 'model', references };
        }

        this.turn.annotations.push(...(annotations ?? []));
      }
    );
    const modelConfiguration = await this.getModelConfiguration();
    const agentsUrl = this.turnContext.ctx.get(NetworkConfiguration).getCAPIUrl(this.turnContext.ctx, 'agents');
    const authToken = await this.turnContext.ctx.get(CopilotTokenManager).getGitHubToken(this.turnContext.ctx);
    const params: ChatMLFetcher.Params = {
      modelConfiguration: modelConfiguration,
      engineUrl: agentsUrl,
      endpoint: this.agent.endpoint ?? this.agent.slug,
      messages,
      uiKind: 'conversationPanel',
      intentParams: { intent: true, intent_threshold: 0.7, intent_content: this.turn.request.message },
      authToken: authToken,
    };

    const fetchResult = await this.chatFetcher.fetchResponse(
      params,
      token,
      baseTelemetryWithExp,
      async (text, delta) => {
        finishCallback.isFinishedAfter(text, delta);
      }
    );

    this.ensureAgentIsAuthorized(fetchResult);
    return await this.postProcessor.postProcess(
      fetchResult,
      token,
      finishCallback.appliedText,
      baseTelemetryWithExp,
      augmentedTelemetryWithExp,
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
    userTelemetryWithExp: TelemetryWithExp,
    template?: IPromptTemplate,
    doc?: TextDocument
  ): TelemetryWithExp {
    return extendUserMessageTelemetryData(
      this.conversation,
      'conversationPanel',
      this.turn.request.message.length,
      conversationPrompt.tokens,
      template?.id,
      undefined,
      userTelemetryWithExp,
      conversationPrompt.skillResolutions
    );
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
