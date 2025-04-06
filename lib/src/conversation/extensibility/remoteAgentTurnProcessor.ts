import type { Context } from '../../context.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Unknown, WorkDoneToken, Chat, SkillId } from '../../types.ts';
import type { CopilotTextDocument } from '../../textDocument.ts';
import type { Turn, Conversation } from '../conversation.ts';
import type { TurnContext } from '../turnContext.ts';
import type { TelemetryWithExp } from '../../telemetry.ts';
import type { RemoteAgent } from './remoteAgent.ts';
import type { ITurnProcessor } from '../../../../agent/src/conversation/turnProcessorFactory.ts';
import type {} from '../../../../prompt/src/tokenization/index.ts';
import type {} from '../../openai/fetch.ts';

import { convertToCopilotReferences } from './references.ts';
import { skillsToReference } from './skillToReferenceAdapters.ts';
import { ChatMLFetcher } from '../chatMLFetcher.ts';
import { ConversationFinishCallback } from '../conversationFinishCallback.ts';
import { ConversationInspector } from '../conversationInspector.ts';
import { ConversationProgress } from '../conversationProgress.ts';
import { ChatFetchResultPostProcessor } from '../fetchPostProcessor.ts';
import { conversationLogger } from '../logger.ts';
import { filterTurns } from '../prompt/fromHistory.ts';
import { createTelemetryWithExpWithId, extendUserMessageTelemetryData } from '../telemetry.ts';
import { CopilotTokenManager } from '../../auth/copilotTokenManager.ts';
import { NetworkConfiguration } from '../../networkConfiguration.ts';
import { v4 as uuidv4 } from 'uuid';
import type {} from '../openai/openai.ts';
import type {} from '../../openai/fetch.ts';

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

namespace RemoteAgentTurnProcessor {
  export interface IAgent {
    // number `super(0,...)` ./conversation/extensibility/remoteAgent.ts
    // no id ../agents/agents.ts
    // readonly id: number;
    readonly slug: string;
    readonly name: string;
    // ../agents/agents.ts
    readonly description: string;
    // no endpoint ../agents/agents.ts
    readonly endpoint?: string;
    // ../../../../agent/src/methods/conversation/conversationAgents.ts
    readonly avatarUrl?: string;

    additionalSkills: (ctx: Context) => Promise<SkillId[]>;
    // ProjectAgent does not have turnProcessor ../agents/agents.ts
    // optional if(agent?.turnProcessor) ../../../../agent/src/conversation/turnProcessorFactory.ts
    turnProcessor?: (turnContext: TurnContext) => ITurnProcessor;
  }
}

class RemoteAgentTurnProcessor {
  readonly conversationProgress: ConversationProgress;
  readonly postProcessor: ChatFetchResultPostProcessor;
  readonly conversation: Conversation;
  readonly turn: Turn;
  constructor(
    readonly agent: RemoteAgent,
    readonly turnContext: TurnContext,
    readonly chatFetcher = new ChatMLFetcher(turnContext.ctx)
  ) {
    this.conversationProgress = turnContext.ctx.get(ConversationProgress);
    this.postProcessor = new ChatFetchResultPostProcessor(turnContext, this.chatFetcher, !1);
    this.conversation = turnContext.conversation;
    this.turn = turnContext.turn;
  }

  async process(
    workDoneToken: WorkDoneToken,
    cancellationToken: CancellationToken,
    followUp: Unknown.FollowUp,
    doc: CopilotTextDocument
  ): Promise<void> {
    try {
      await this.processWithAgent(workDoneToken, cancellationToken, this.turnContext, doc);
    } catch (err) {
      conversationLogger.error(this.turnContext.ctx, `Error processing turn ${this.turn.id}`, err);
      const errorMessage = err instanceof Error ? err.message : String(err);
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
    workDoneToken: WorkDoneToken,
    cancellationToken: CancellationToken,
    turnContext: TurnContext,
    doc: CopilotTextDocument
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
    const conversationPrompt = await this.buildAgentPrompt(turnContext);
    if (!conversationPrompt) await this.endTurnWithResponse(`No prompt created for agent ${this.agent.id}`, 'error');
    else {
      const promptInspection = {
        type: 'user' as 'user',
        prompt: JSON.stringify(conversationPrompt.messages, null, 2),
        tokens: conversationPrompt.tokens,
      };
      await turnContext.ctx.get(ConversationInspector).inspectPrompt(promptInspection);
      await turnContext.steps.start(GENERATE_RESPONSE_STEP, 'Generating response');
      const augmentedTelemetryWithExp = this.augmentTelemetry(
        conversationPrompt,
        telemetryWithExp,
        this.turn.template,
        doc
      );

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
                followUp: response.followup,
                suggestedTitle: response.suggestedTitle,
                skillResolutions: conversationPrompt.skillResolutions,
              }
        );
      }
    }
  }

  async buildAgentPrompt(turnContext: TurnContext) {
    const messages = this.createMessagesFromHistory(turnContext);
    const outgoingReferences = await this.computeCopilotReferences(turnContext);
    const sessionId = this.getOrCreateAgentSessionId(turnContext);

    if (this.turn.agent) {
      this.turn.agent.sessionId = sessionId;
    }

    if (this.turn.confirmationResponse) {
      this.addConfirmationResponse(this.turn.confirmationResponse, messages);
    } else {
      messages.push({
        role: 'user',
        content: turnContext.turn.request.message,
        copilot_references: outgoingReferences.length > 0 ? outgoingReferences : undefined,
      });
    }

    return { messages, tokens: -1, skillResolutions: [] };
  }

  getOrCreateAgentSessionId(turnContext: TurnContext): string {
    const agentSlug = this.turn.agent?.agentSlug;
    if (agentSlug) {
      for (const turn of turnContext.conversation.turns)
        if (turn.agent?.agentSlug === agentSlug && turn.agent.sessionId) {
          return turn.agent.sessionId;
        }
    }
    return uuidv4();
  }

  addConfirmationResponse(
    confirmationResponse: NonNullable<Turn['confirmationResponse']>,
    messages: Chat.ChatMessage[]
  ) {
    messages.push({
      role: 'user',
      content: '',
      copilot_confirmations: [confirmationResponse],
    });
  }

  createMessagesFromHistory(turnContext: TurnContext): Chat.ChatMessage[] {
    return filterTurns(turnContext.conversation.turns.slice(0, -1), this.agent.slug).flatMap((turn) => {
      const messages: Chat.ChatMessage[] = [];

      if (turn.request) {
        messages.push({ role: 'user', content: turn.request.message });
      }

      if (turn.response && turn.response.type === 'model') {
        let references = convertToCopilotReferences(turn.response.references);
        messages.push({
          role: 'assistant',
          content: turn.response.message,
          copilot_references: references.length > 0 ? references : undefined,
        });
      }
      return messages;
    });
  }
  async computeCopilotReferences(turnContext: TurnContext) {
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
    doc: CopilotTextDocument
  ) {
    token.onCancellationRequested(async () => {
      await this.cancelProgress();
    });
    const finishCallback = new ConversationFinishCallback((text, annotations, references, errors, confirmation) => {
      const confirmationRequest = confirmation ? { ...confirmation, agentSlug: this.agent.slug } : undefined;

      this.conversationProgress.report(this.conversation, this.turn, {
        reply: text,
        annotations,
        references,
        notifications: errors.map((e) => ({ message: (e as any).message, severity: 'warning' })),
        confirmationRequest,
      });

      if (this.turn.response) {
        this.turn.response.message += text;
        this.turn.response.references!.push(...references); // MARK problematic it assume the response still the one set in the else branch
      } else {
        this.turn.response = { message: text, type: 'model', references };
      }

      this.turn.annotations.push(...(annotations ?? []));

      if (confirmationRequest) {
        this.turn.confirmationRequest = confirmationRequest;
      }
    });
    const agentsUrl = this.turnContext.ctx.get(NetworkConfiguration).getCAPIUrl(this.turnContext.ctx, 'agents');
    const authToken = await this.turnContext.ctx.get(CopilotTokenManager).getGitHubToken();
    const params: ChatMLFetcher.Params = {
      engineUrl: agentsUrl,
      endpoint: this.agent.endpoint ?? this.agent.slug,
      messages,
      uiKind: 'conversationPanel',
      intentParams: { intent: true, intent_threshold: 0.7, intent_content: this.turn.request.message },
      authToken,
      copilot_thread_id: this.turn.agent?.sessionId,
    };

    const fetchResult = await this.chatFetcher.fetchResponse(params, token, baseTelemetryWithExp, async (text, delta) =>
      finishCallback.isFinishedAfter(text, delta)
    );

    this.ensureAgentIsAuthorized(fetchResult);
    return await this.postProcessor.postProcess(
      fetchResult,
      token,
      finishCallback.appliedText,
      baseTelemetryWithExp,
      augmentedTelemetryWithExp.extendedBy(this.addExtensibilityInfoTelemetry()),
      this.turn.request.message,
      'conversationPanel',
      doc
    );
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
    template?: Turn.Template,
    doc?: CopilotTextDocument
  ): TelemetryWithExp {
    return extendUserMessageTelemetryData(
      this.conversation,
      'conversationPanel',
      this.turn.request.message.length,
      conversationPrompt.tokens,
      template?.templateId,
      undefined,
      userTelemetryWithExp,
      conversationPrompt.skillResolutions
    );
  }
  addExtensibilityInfoTelemetry() {
    return {
      extensibilityInfoJson: JSON.stringify({
        agent: this.agent.slug,
        outgoingReferences: this.turn.request.references?.map((r) => r.type) ?? [],
        incomingReferences: this.turn.response?.references?.map((r) => r.type) ?? [],
      }),
    };
  }

  async finishGenerateResponseStep(response: unknown, turnContext: TurnContext) {
    const error = (response as any).error; // MARK
    error
      ? await turnContext.steps.error(GENERATE_RESPONSE_STEP, error.message)
      : await turnContext.steps.finish(GENERATE_RESPONSE_STEP);
  }

  async endProgress(payload?: ConversationProgress.IEndPayload) {
    await this.turnContext.steps.finishAll();
    await this.conversationProgress.end(this.conversation, this.turn, payload);
  }

  async cancelProgress() {
    await this.turnContext.steps.finishAll('cancelled');
    await this.conversationProgress.cancel(this.conversation, this.turn);
  }
}

export { RemoteAgentTurnProcessor };
