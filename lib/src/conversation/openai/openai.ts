import { Type } from '@sinclair/typebox';
import { ToolCall, Chat, OpenAIRequestId } from '../../types.ts';
import { Context } from '../../context.ts';
import { TelemetryData } from '../../telemetry.ts';

import { logEngineMessages } from '../telemetry.ts';

type ChatCompletion = {
  message: Chat.ChatMessage;
  choiceIndex: number;
  requestId: OpenAIRequestId;
  blockFinished: boolean;
  finishReason: string;
  tokens: string[]; // MARK ?? might be string[]
  numTokens: number;
  // optional ./fetch.ts
  tool_calls?: ToolCall[];
  function_call?: { name: string; arguments: unknown[] };
  telemetryData: TelemetryData;
};

// ./stream.ts
function convertToChatCompletion(
  ctx: Context,
  message: Chat.ChatMessage,
  jsonData: {
    tool_calls: ToolCall[];
    // 1.40.0 added
    function_call?: { name: string; arguments: unknown[] };
    tokens: string[];
  },
  choiceIndex: number,
  requestId: OpenAIRequestId,
  blockFinished: boolean,
  finishReason: string,
  telemetryData: TelemetryData
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
    blockFinished,
    finishReason,
    tokens: jsonData.tokens,
    numTokens: jsonData.tokens.length,
    tool_calls: jsonData.tool_calls,
    function_call: jsonData.function_call,
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

const ChatConfirmationResponseSchema = Type.Optional(
  Type.Object({
    agentSlug: Type.String(),
    state: Type.Union([Type.Literal('accepted'), Type.Literal('dismissed')]),
    confirmation: Type.Any(),
  })
);

export { ChatConfirmationResponseSchema, ChatRole, StringEnum, convertToChatCompletion, ChatCompletion };
