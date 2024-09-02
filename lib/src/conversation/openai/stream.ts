import { IStreamingData } from '../../openai/stream.ts';
import { Chat, OpenAIRequestId } from '../../types.ts';
import { type TelemetryData } from '../../telemetry.ts';
import { Context } from '../../context.ts';
import { convertToAPIJsonData } from '../../openai/stream.ts';
import { convertToChatCompletion } from './openai.ts';
import { Logger, LogLevel } from '../../logger.ts';

interface CompletionDetails {
  solution: IStreamingData;
  finishOffset?: number;
  index: number;
  reason: string;
  requestId: OpenAIRequestId;
}

const streamChoicesLogger = new Logger(LogLevel.INFO, 'streamMessages');

function prepareChatCompletionForReturn(ctx: Context, c: CompletionDetails, telemetryData: TelemetryData) {
  let messageContent = c.solution.text.join('');
  let blockFinished = !!c.finishOffset;

  if (blockFinished) {
    streamChoicesLogger.debug(ctx, `message ${c.index}: early finish at offset ${c.finishOffset} `);
    messageContent = messageContent.substring(0, c.finishOffset!);
  }

  streamChoicesLogger.info(ctx, `message ${c.index} returned.finish reason: [${c.reason}]`);
  streamChoicesLogger.debug(
    ctx,
    `message ${c.index} details: finishOffset: [${c.finishOffset}] completionId: [{ ${c.requestId.completionId}}] created: [{ ${c.requestId.created}}]`
  );

  const jsonData = convertToAPIJsonData(c.solution);

  return convertToChatCompletion(
    ctx,
    { role: Chat.Role.Assistant, content: messageContent },
    jsonData,
    c.index,
    c.requestId,
    blockFinished,
    c.reason ?? '',
    telemetryData,
    undefined
  );
}

export { prepareChatCompletionForReturn };
