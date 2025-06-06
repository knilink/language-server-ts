import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../context.ts';
import type { UiKind, SkillId, Unknown, Skill } from '../../types.ts';
import { TelemetryStore } from '../../types.ts';
import type { TelemetryData, TelemetryWithExp } from '../../telemetry.ts';
import type { TurnContext } from '../turnContext.ts';
import type { ChatMLFetcher } from '../chatMLFetcher.ts';
import type { PromptOptions } from './strategies/types.ts';

import { ConversationPromptEngine } from './conversationPromptEngine.ts';
import { ConversationInspector } from '../conversationInspector.ts';
import { conversationLogger } from '../logger.ts';
import { ModelConfigurationProvider } from '../modelConfigurations.ts';
import { getSupportedModelFamiliesForPrompt } from '../modelMetadata.ts';
import { telemetryPrefixForUiKind } from '../telemetry.ts';
import { telemetry } from '../../telemetry.ts';

type MetaPromptContext = { skillIds: SkillId[] };

const MAX_SKILLS = 4;
const DEFAULT_PROMPT_CONTEXT: MetaPromptContext = { skillIds: [] };

class MetaPromptFetcher {
  constructor(
    readonly ctx: Context,
    readonly chatFetcher: ChatMLFetcher
  ) {}

  public async fetchPromptContext(
    turnContext: TurnContext,
    selectableSkillDescriptors: Skill.ISkillDescriptor[],
    token: CancellationToken,
    baseTelemetryWithExp: TelemetryWithExp,
    uiKind: UiKind
  ): Promise<MetaPromptContext> {
    const userQuestion = turnContext.conversation.getLastTurn().request.message;
    if (selectableSkillDescriptors.length > 0) {
      const modelConfiguration = await this.ctx
        .get(ModelConfigurationProvider)
        .getBestChatModelConfig(getSupportedModelFamiliesForPrompt('meta'), { tool_calls: true });
      const promptOptions: PromptOptions = {
        promptType: 'meta',
        supportedSkillDescriptors: selectableSkillDescriptors,
        modelConfiguration,
      };
      const prompt = await this.ctx.get(ConversationPromptEngine).toPrompt(turnContext, promptOptions);
      const extendedTelemetryWithExp = baseTelemetryWithExp.extendedBy(
        { messageSource: 'chat.metaprompt' },
        { promptTokenLen: prompt.tokens }
      );
      const params: ChatMLFetcher.Params = {
        modelConfiguration: modelConfiguration,
        messages: prompt.messages,
        uiKind: uiKind,
      };
      if (prompt.toolConfig === undefined) throw new Error('No tool call configuration found in meta prompt.');
      params.tool_choice = prompt.toolConfig.tool_choice;
      params.tools = prompt.toolConfig.tools;
      let fetchResult = await this.chatFetcher.fetchResponse(params, token, extendedTelemetryWithExp);

      if (fetchResult.type !== 'success') {
        conversationLogger.error(this.ctx, 'Failed to fetch prompt context, trying again...');
        fetchResult = await this.chatFetcher.fetchResponse(params, token, extendedTelemetryWithExp);
      }

      await turnContext.ctx.get(ConversationInspector).inspectFetchResult(fetchResult);
      return await this.handleResult(fetchResult, extendedTelemetryWithExp, userQuestion, uiKind, prompt.toolConfig);
    } else return DEFAULT_PROMPT_CONTEXT;
  }

  private async handleResult(
    fetchResult: ChatMLFetcher.Response,
    baseTelemetryWithExp: TelemetryWithExp,
    messageText: string,
    uiKind: UiKind,
    toolConfig: Unknown.ToolConfig
  ): Promise<MetaPromptContext> {
    if (fetchResult.type !== 'success') {
      this.telemetryError(baseTelemetryWithExp, fetchResult);
      return DEFAULT_PROMPT_CONTEXT;
    }

    let skillIds;
    if (fetchResult.toolCalls && fetchResult.toolCalls.length > 0) {
      skillIds = toolConfig.extractArguments(fetchResult.toolCalls[0]).skillIds?.slice(0, MAX_SKILLS);
    } else
      return conversationLogger.error(this.ctx, 'Missing tool call in meta prompt response'), DEFAULT_PROMPT_CONTEXT;
    const metapromptTelemetryData = baseTelemetryWithExp.extendedBy(
      {
        uiKind: uiKind,
        skillIds: skillIds?.join(',') ?? '',
      },
      { numTokens: fetchResult.numTokens + fetchResult.toolCalls[0].approxNumTokens }
    );
    const metapromptTelemetryDataRestricted = metapromptTelemetryData.extendedBy({ messageText: messageText });
    telemetry(this.ctx, `${telemetryPrefixForUiKind(uiKind)}.metaPrompt`, metapromptTelemetryData, 0);
    telemetry(this.ctx, `${telemetryPrefixForUiKind(uiKind)}.promptContext`, metapromptTelemetryDataRestricted, 1);
    return { skillIds: skillIds ?? [] };
  }

  private telemetryError(
    baseUserTelemetry: TelemetryData,
    fetchResult: Exclude<ChatMLFetcher.Response, { type: 'success' }>
  ) {
    const telemetryErrorData = baseUserTelemetry.extendedBy({
      resultType: fetchResult.type,
      reason: 'reason' in fetchResult ? fetchResult.reason : '',
    });
    telemetry(this.ctx, 'conversation.promptContextError', telemetryErrorData, TelemetryStore.RESTRICTED);
  }
}

export { MetaPromptFetcher };
