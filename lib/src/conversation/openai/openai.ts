import { Type } from '@sinclair/typebox';
import { ToolCall, Unknown, Chat, OpenAIRequestId, Model } from '../../types.ts';
import { Context } from '../../context.ts';
import { TelemetryData } from '../../telemetry.ts';

import { logEngineMessages } from '../telemetry.ts';

type ChatCompletion = {
  message: Chat.ChatMessage;
  choiceIndex: number;
  requestId: OpenAIRequestId;
  modelInfo?: Unknown.ModelInfo;
  blockFinished: boolean;
  finishReason: string;
  tokens: string[]; // MARK ?? might be string[]
  numTokens: number;
  tool_calls: ToolCall[];
  telemetryData: TelemetryData;
};

// ./stream.ts
function convertToChatCompletion(
  ctx: Context,
  message: Chat.ChatMessage,
  jsonData: {
    tool_calls: ToolCall[];
    tokens: string[];
  },
  choiceIndex: number,
  requestId: OpenAIRequestId,
  blockFinished: boolean,
  finishReason: string,
  telemetryData: TelemetryData,
  modelInfo?: Unknown.ModelInfo
): ChatCompletion {
  let chatMessageWithToolCalls = JSON.parse(JSON.stringify(message));

  if (jsonData.tool_calls) {
    chatMessageWithToolCalls = { ...chatMessageWithToolCalls, tool_calls: jsonData.tool_calls };
  }

  logEngineMessages(ctx, [chatMessageWithToolCalls], telemetryData);

  return {
    message,
    choiceIndex,
    requestId,
    modelInfo,
    blockFinished,
    finishReason,
    tokens: jsonData.tokens,
    numTokens: jsonData.tokens.length,
    tool_calls: jsonData.tool_calls,
    telemetryData,
  };
}

enum ChatRole {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
  Function = 'function',
}

function StringEnum(values: string[], options?: { description: string }) {
  return Type.Unsafe({
    type: 'string',
    enum: values,
    description: options?.description,
  });
}

export { ChatRole, convertToChatCompletion, ChatCompletion, StringEnum };
