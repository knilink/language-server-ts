import { type Static } from '@sinclair/typebox';
import { type ConversationSourceSchema } from './schema.ts';

import { Context } from '../context.ts';
import { UiKind, TelemetryProperties, TelemetryMeasurements, TelemetryStore, Unknown } from '../types.ts';
import { Turn, Conversation } from '../conversation/conversation.ts';
import { TextDocument } from '../textDocument.ts';

import { v4 as uuidv4 } from 'uuid';
import {} from '../openai/fetch.ts';
import { TelemetryData, telemetry } from '../telemetry.ts';

function createTelemetryWithId(messageId: string, conversationId: string) {
  return TelemetryData.createAndMarkAsIssued({ messageId, conversationId });
}

function extendUserMessageTelemetryData(
  conversation: Conversation,
  uiKind: UiKind,
  messageCharLen: number,
  promptTokenLen: number,
  // undefined ./extensibility/remoteAgentTurnProcessor.ts
  suggestion: string | undefined,
  suggestionId: string | undefined,
  baseTelemetry: TelemetryData,
  skillResolutions: Unknown.SkillResolution[]
): TelemetryData {
  const turn: Turn = conversation.turns[conversation.turns.length - 1];
  const skillIds = turn.skills.map((skill) => skill.skillId).sort(); // MARK ?? skill.id?
  const properties: TelemetryProperties = {
    source: 'user',
    turnIndex: (conversation.turns.length - 1).toString(),
    uiKind,
    skillIds: skillIds.join(','),
  };
  const measurements: TelemetryMeasurements = { promptTokenLen, messageCharLen };

  if (suggestion) properties.suggestion = suggestion;
  if (suggestionId) properties.suggestionId = suggestionId;
  if (skillResolutions.length > 0) {
    properties.skillResolutionsJson = mapSkillResolutionsForTelemetry(skillResolutions);
  }

  return baseTelemetry.extendedBy(properties, measurements);
}

function mapSkillResolutionsForTelemetry(skillResolutions: Unknown.SkillResolution[]): string {
  return JSON.stringify(
    skillResolutions.map((resolution) => ({
      skillId: resolution.skillId,
      resolution: resolution.resolution,
      fileStatus: resolution.files?.map((file) => file.status),
      tokensPreEliding: resolution.tokensPreEliding ?? 0,
      resolutionTimeMs: resolution.resolutionTimeMs ?? 0,
      processingTimeMs: resolution.processingTimeMs ?? 0,
    }))
  );
}

function createUserMessageTelemetryData(
  ctx: Context,
  uiKind: UiKind,
  messageText: string,
  offTopic?: boolean,
  doc?: TextDocument,
  baseTelemetry?: TelemetryData
): string {
  if (offTopic != null) {
    baseTelemetry = baseTelemetry?.extendedBy({ offTopic: offTopic.toString() });
  }

  return telemetryMessage(ctx, doc!, uiKind, messageText, { uiKind }, {}, baseTelemetry).messageId;
}

function createModelMessageTelemetryData(
  ctx: Context,
  conversation: Conversation,
  uiKind: UiKind,
  appliedText: string,
  responseNumTokens: number,
  requestId: string,
  doc?: TextDocument,
  baseTelemetry?: TelemetryData
): string {
  let codeBlockLanguages = getCodeBlocks(appliedText);
  const { messageId } = telemetryMessage(
    ctx,
    doc,
    uiKind,
    appliedText,
    {
      source: 'model',
      turnIndex: (conversation.turns.length - 1).toString(),
      headerRequestId: requestId,
      uiKind: uiKind,
      codeBlockLanguages: JSON.stringify({ ...codeBlockLanguages }),
    },
    {
      messageCharLen: appliedText.length,
      numCodeBlocks: codeBlockLanguages.length,
      numTokens: responseNumTokens,
    },
    baseTelemetry
  );
  return messageId;
}

function createOffTopicMessageTelemetryData(
  ctx: Context,
  conversation: Conversation,
  uiKind: UiKind,
  appliedText: string,
  userMessageId: string,
  doc?: TextDocument,
  baseTelemetry?: TelemetryData
): string {
  const { messageId } = telemetryMessage(
    ctx,
    doc,
    uiKind,
    appliedText,
    {
      source: 'offTopic',
      turnIndex: conversation.turns.length.toString(),
      userMessageId,
      uiKind,
    },
    { messageCharLen: appliedText.length },
    baseTelemetry
  );
  return messageId;
}

function createSuggestionMessageTelemetryData(
  ctx: Context,
  conversation: Conversation,
  uiKind: UiKind,
  messageText: string,
  promptTokenLen: number,
  suggestion: string,
  suggestionId: string,
  doc?: TextDocument,
  baseTelemetry?: TelemetryData
): string {
  const { messageId, standardTelemetryData: telemetryData } = telemetryMessage(
    ctx,
    doc,
    uiKind,
    messageText,
    {
      source: 'suggestion',
      suggestion,
      turnIndex: (conversation.turns.length - 1).toString(),
      uiKind,
      suggestionId,
    },
    { promptTokenLen, messageCharLen: messageText.length },
    baseTelemetry
  );

  createSuggestionSelectedTelemetryData(
    ctx,
    uiKind,
    suggestion,
    messageId,
    telemetryData.properties.conversationId,
    suggestionId,
    doc
  );

  return messageId;
}

function telemetryMessage(
  ctx: Context,
  document: TextDocument | undefined,
  uiKind: UiKind,
  messageText: string,
  properties: TelemetryProperties,
  measurements: TelemetryMeasurements,
  baseTelemetry?: TelemetryData
): { messageId: string; standardTelemetryData: TelemetryData } {
  const telemetryData = baseTelemetry ?? TelemetryData.createAndMarkAsIssued();
  const restrictedProperties: TelemetryProperties = { messageText, ...properties };
  let messageId: string | undefined = undefined;

  // MARK fuck this
  if ('messageId' in properties) {
    messageId = properties.messageId;
  } else if ('messageId' in telemetryData.properties) {
    messageId = properties.messageId;
  }

  if (!messageId) {
    messageId = uuidv4();
    properties.messageId = messageId;
    restrictedProperties.messageId = messageId;
  }

  if (document) {
    properties.languageId = document.languageId;
    measurements.documentLength = document.getText().length;
    measurements.documentLineCount = document.lineCount;
  }

  const standardTelemetryData = telemetryData.extendedBy(properties, measurements);
  const restrictedTelemetryData = telemetryData.extendedBy(restrictedProperties);
  const prefix = telemetryPrefixForUiKind(uiKind);

  telemetry(ctx, `${prefix}.message`, standardTelemetryData);
  telemetry(ctx, `${prefix}.messageText`, restrictedTelemetryData, TelemetryStore.RESTRICTED);

  return { messageId, standardTelemetryData };
}

function createSuggestionShownTelemetryData(
  ctx: Context,
  uiKind: UiKind,
  suggestion: string,
  messageId: string,
  conversationId: string,
  suggestionId: string,
  doc?: TextDocument,
  telemetryMeasurements: TelemetryMeasurements = {}
): TelemetryData {
  return telemetryUserAction(
    ctx,
    doc,
    {
      suggestion,
      messageId,
      conversationId,
      suggestionId,
      uiKind,
    },
    telemetryMeasurements,
    'conversation.suggestionShown'
  );
}

function createSuggestionSelectedTelemetryData(
  ctx: Context,
  uiKind: UiKind,
  suggestion: string,
  messageId: string,
  conversationId: string,
  suggestionId: string,
  doc?: TextDocument
): TelemetryData {
  return telemetryUserAction(
    ctx,
    doc,
    {
      suggestion,
      messageId,
      conversationId,
      suggestionId,
      uiKind,
    },
    {},
    'conversation.suggestionSelected'
  );
}

function telemetryUserAction(
  ctx: Context,
  document: TextDocument | undefined,
  properties: TelemetryProperties,
  measurements: TelemetryMeasurements,
  name: string,
  baseTelemetry?: TelemetryData
): TelemetryData {
  const telemetryData = baseTelemetry ?? TelemetryData.createAndMarkAsIssued();
  if (document) {
    properties.languageId = document.languageId;
    measurements.documentLength = document.getText().length;
    measurements.documentLineCount = document.lineCount;
  }
  const standardTelemetryData = telemetryData.extendedBy(properties, measurements);
  telemetry(ctx, name, standardTelemetryData);
  return standardTelemetryData;
}

async function logEngineMessages(ctx: Context, messages: unknown[], telemetryData: TelemetryData): Promise<void> {
  const telemetryDataWithPrompt = telemetryData.extendedBy({ messagesJson: JSON.stringify(messages) });
  await telemetry(ctx, 'engine.messages', telemetryDataWithPrompt, TelemetryStore.RESTRICTED);
}

function telemetryPrefixForUiKind(uiKind?: UiKind): 'inlineConversation' | 'conversation' {
  switch (uiKind) {
    case 'conversationInline':
      return 'inlineConversation';
    case 'conversationPanel':
    default:
      return 'conversation';
  }
}

function getCodeBlocks(text: string): string[] {
  const textLines = text.split(`\n`);
  const codeBlockLanguages: string[] = [];
  const languageStack: string[] = [];
  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i];
    if (line.startsWith('```')) {
      if (languageStack.length > 0 && line === '```') {
        codeBlockLanguages.push(languageStack.pop()!);
      } else if (languageStack.length === 0) {
        languageStack.push(line.substring(3));
      }
    }
  }
  return codeBlockLanguages;
}

function uiKindToIntent(uiKind: UiKind): 'conversation-inline' | 'conversation-panel' {
  return uiKind === 'conversationInline' ? 'conversation-inline' : 'conversation-panel';
}

function uiKindToMessageSource(uiKind: UiKind): 'chat.inline' | 'chat.user' {
  return uiKind === 'conversationInline' ? 'chat.inline' : 'chat.user';
}

// optional ../../../agent/src/methods/conversation/conversationTurnDelete.ts
function conversationSourceToUiKind(conversationSource?: Static<typeof ConversationSourceSchema>): UiKind {
  return conversationSource === 'inline' ? 'conversationInline' : 'conversationPanel';
}

export {
  logEngineMessages,
  createTelemetryWithId,
  telemetryPrefixForUiKind,
  createSuggestionShownTelemetryData,
  createUserMessageTelemetryData,
  createModelMessageTelemetryData,
  uiKindToMessageSource,
  createOffTopicMessageTelemetryData,
  extendUserMessageTelemetryData,
  uiKindToIntent,
  conversationSourceToUiKind,
  createSuggestionMessageTelemetryData,
  telemetryUserAction,
};
