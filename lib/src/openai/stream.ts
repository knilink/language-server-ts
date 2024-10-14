import { Readable } from 'node:stream';

import { Context } from '../context.ts';
import { Response } from '../networking.ts';
import { CancellationToken } from '../../../agent/src/cancellation.ts';
import {
  AnnotationsMap,
  OpenAIRequestId,
  Choice,
  Logprob,
  TokenLogprob,
  TopLogprob,
  TextOffset,
  Token,
  ToolCall,
  Unknown,
  FunctionCall,
} from '../types.ts';

import { Logger, LogLevel } from '../logger.ts';
import { telemetry, TelemetryData, TelemetryWithExp } from '../telemetry.ts';
import { Features } from '../experiments/features.ts';
import { convertToAPIChoice } from './openai.ts';
import { getRequestId } from './fetch.ts';
import { Reference } from '../conversation/schema.ts';

interface IStreamingToolCall {
  name?: string;
  // JSON.parse(toolCall.arguments.join(''))
  arguments: string[];
}

interface IStreamingData {
  tool_calls: IStreamingToolCall[];
  text: string[];
  logprobs: Logprob[][];
  top_logprobs: TopLogprob[][];
  text_offset: TextOffset[][];
  tokens: Token[][];
}

type APIJsonData = {
  text: string;
  tokens: IStreamingData['text'];
  tool_calls: ToolCall[];
  logprobs?: {
    token_logprobs: TokenLogprob[];
    top_logprobs: TopLogprob[];
    text_offset: TextOffset[];
    tokens: Token[];
  };
  function_call?: { name: string; arguments: unknown[] };
};

type Completion = {
  solution: IStreamingData;
  finishOffset?: number;
  index: number;
  reason: string;
  requestId: OpenAIRequestId;
  // maybe optional
  model?: string;
  // maybe optional number
  usage?: number;
};

const streamChoicesLogger = new Logger(LogLevel.INFO, 'streamChoices');

function splitChunk(chunk: string): [string[], string] {
  let dataLines: string[] = chunk.split(`\n`);
  const newExtra = dataLines.pop()!; // no way to be undefined as long as chunk is a string
  return [dataLines.filter((line) => line), newExtra];
}

function prepareSolutionForReturn(ctx: Context, c: Completion, telemetryData: TelemetryWithExp) {
  let completionText: string = c.solution.text.join('');
  let blockFinished: boolean = false;

  if (c.finishOffset !== undefined) {
    streamChoicesLogger.debug(ctx, `solution ${c.index}: early finish at offset ${c.finishOffset}`);
    completionText = completionText.substring(0, c.finishOffset);
    blockFinished = true;
  }

  streamChoicesLogger.info(ctx, `solution ${c.index} returned. finish reason: [${c.reason}]`);
  streamChoicesLogger.debug(
    ctx,
    `solution ${c.index} details: finishOffset: [${c.finishOffset}] completionId: [{${c.requestId.completionId}}] created: [{${c.requestId.created}}]`
  );

  const jsonData = convertToAPIJsonData(c.solution);
  return convertToAPIChoice(ctx, completionText, jsonData, c.index, c.requestId, blockFinished, telemetryData);
}

function convertToAPIJsonData(streamingData: IStreamingData): APIJsonData {
  const joinedText = streamingData.text.join('');
  const toolCalls = extractToolCalls(streamingData);
  const functionCall = extractFunctionCall(streamingData);
  const out = { text: joinedText, tokens: streamingData.text, tool_calls: toolCalls, function_call: functionCall };

  if (streamingData.logprobs.length === 0) return out;

  const flattenedLogprobs = streamingData.logprobs.flat();
  const flattenedTopLogprobs = streamingData.top_logprobs.flat();
  const flattenedOffsets = streamingData.text_offset.flat();
  const flattenedTokens = streamingData.tokens.flat();

  return {
    ...out,
    logprobs: {
      token_logprobs: flattenedLogprobs,
      top_logprobs: flattenedTopLogprobs,
      text_offset: flattenedOffsets,
      tokens: flattenedTokens,
    },
  };
}

type CopilotConfirmation = {
  title: string;
  message: string;
  confirmation: boolean;
};
function isCopilotConfirmation(obj: Record<string, unknown>): obj is CopilotConfirmation {
  return typeof obj.title == 'string' && typeof obj.message == 'string' && !!obj.confirmation;
}

function extractToolCalls(streamingData: IStreamingData): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  for (let toolCall of streamingData.tool_calls)
    if (toolCall.name) {
      const args = toolCall.arguments.length > 0 ? JSON.parse(toolCall.arguments.join('')) : [];
      toolCalls.push({
        type: 'function',
        function: { name: toolCall.name, arguments: args },
        approxNumTokens: toolCall.arguments.length + 1,
      });
    }
  return toolCalls;
}

function extractFunctionCall(streamingData: any): { name: string; arguments: string[] } | undefined {
  if (streamingData.function_call.name) {
    const args =
      streamingData.function_call.arguments.length > 0
        ? JSON.parse(streamingData.function_call.arguments.join(''))
        : [];
    return { name: streamingData.function_call.name, arguments: args };
  }
}

class APIJsonDataStreaming implements IStreamingData {
  logprobs: Logprob[][] = [];
  top_logprobs: TopLogprob[][] = [];
  text: string[] = [];
  tokens: Token[][] = [];
  text_offset: TextOffset[][] = [];
  copilot_annotations = new StreamCopilotAnnotations();
  tool_calls: StreamingToolCall[] = [];
  function_call = new StreamingFunctionCall();
  copilot_references: Reference[] = [];

  append(choice: Choice) {
    if (choice.text) this.text.push(choice.text);
    if (choice.delta?.content && choice.delta.role !== 'function') this.text.push(choice.delta.content);

    const { logprobs } = choice;
    if (logprobs) {
      this.tokens.push(logprobs.tokens ?? []);
      this.text_offset.push(logprobs.text_offset ?? []);
      this.logprobs.push(logprobs.token_logprobs ?? []);
      this.top_logprobs.push(logprobs.top_logprobs ?? []);
    }

    if (choice.copilot_annotations) {
      this.copilot_annotations.update(choice.copilot_annotations);
    }

    const deltaCopilotAnnotations = choice.delta?.copilot_annotations;
    if (deltaCopilotAnnotations) {
      this.copilot_annotations.update(deltaCopilotAnnotations);
    }

    const toolCalls = choice.delta?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const index = toolCall.index;
        this.tool_calls[index] ??= new StreamingToolCall();
        this.tool_calls[index].update(toolCall);
      }
      if (choice.delta?.function_call) {
        this.function_call.update(choice.delta.function_call);
      }
    }
  }
}

class StreamingFunctionCall implements FunctionCall {
  name?: string;
  readonly arguments: string[] = [];
  constructor() {}
  update(functionCall: { name?: string; arguments: string }) {
    if (functionCall.name) {
      this.name = functionCall.name;
    }

    this.arguments.push(functionCall.arguments);
  }
}

class StreamingToolCall implements IStreamingToolCall {
  name?: string;
  arguments: string[] = [];

  update(toolCall: { function: { name?: string; arguments: string } }) {
    if (toolCall.function.name) {
      this.name = toolCall.function.name;
    }
    this.arguments.push(toolCall.function.arguments);
  }
}

class StreamCopilotAnnotations {
  private current: AnnotationsMap = {};

  update(annotations: AnnotationsMap) {
    Object.entries(annotations).forEach(([namespace, annotations]) => {
      annotations?.forEach((annotation) => this.update_namespace(namespace, annotation));
    });
  }

  private update_namespace(namespaceKey: string, annotation: Unknown.Annotation) {
    this.current[namespaceKey] ??= [];

    let annotationToUpdate = this.current[namespaceKey];
    const index = annotationToUpdate.findIndex((a) => a.id === annotation.id);
    if (index >= 0) {
      annotationToUpdate[index] = annotation;
    } else {
      annotationToUpdate.push(annotation);
    }
  }

  for(namespaceKey: string): Unknown.Annotation[] {
    return this.current[namespaceKey] ?? [];
  }
}

namespace SSEProcessor {
  export type FinishedCbDelta = {
    text: string;
    copilotConfirmation?: CopilotConfirmation;
    copilotReferences?: Reference[];
    annotations?: StreamCopilotAnnotations;
    copilotErrors?: unknown[];
  };
  export type FinishedCb = (text: string, delta: FinishedCbDelta) => Promise<number | undefined>;
}

class SSEProcessor {
  requestId: OpenAIRequestId;
  stats: ChunkStats;
  solutions: Record<string, APIJsonDataStreaming | null> = {};

  constructor(
    readonly ctx: Context,
    public expectedNumChoices: number,
    public response: Response,
    public body: Readable,
    public telemetryData: TelemetryData,
    public dropCompletionReasons: string[],
    public fastCancellation?: boolean,
    public cancellationToken?: CancellationToken
  ) {
    this.requestId = getRequestId(this.response);
    this.stats = new ChunkStats(this.expectedNumChoices);
  }

  static async create(
    ctx: Context,
    expectedNumChoices: number,
    response: Response,
    telemetryData: TelemetryWithExp,
    dropCompletionReasons?: string[],
    cancellationToken?: CancellationToken
  ): Promise<SSEProcessor> {
    const body = await response.body();
    body.setEncoding('utf8');
    const fastCancellation = ctx.get(Features).fastCancellation(telemetryData);
    return new SSEProcessor(
      ctx,
      expectedNumChoices,
      response,
      body,
      telemetryData,
      dropCompletionReasons ?? ['content_filter'],
      fastCancellation,
      cancellationToken
    );
  }

  async *processSSE(finishedCb: SSEProcessor.FinishedCb = async () => undefined): AsyncGenerator<Completion> {
    try {
      yield* this.processSSEInner(finishedCb);
    } finally {
      if (this.fastCancellation) this.cancel();
      streamChoicesLogger.info(
        this.ctx,
        `request done: headerRequestId: [${this.requestId.headerRequestId}] model deployment ID: [${this.requestId.deploymentId}]`
      );
      streamChoicesLogger.debug(this.ctx, `request stats: ${this.stats}`);
    }
  }

  async *processSSEInner(finishedCb: SSEProcessor.FinishedCb): AsyncGenerator<Completion> {
    let extraData: string = '';
    let currentFinishReason: string | null = null;
    let model: string | undefined;
    let usage: number | undefined;

    networkRead: for await (const chunk of this.body) {
      if (this.maybeCancel('after awaiting body chunk')) return;
      streamChoicesLogger.debug(this.ctx, 'chunk', chunk.toString());
      const [dataLines, remainder] = splitChunk(extraData + chunk.toString());
      extraData = remainder;

      for (const dataLine of dataLines) {
        let lineWithoutData = dataLine.slice(5).trim();
        if (lineWithoutData === '[DONE]') {
          yield* this.finishSolutions(currentFinishReason, model, usage);
          return;
        }
        currentFinishReason = null;

        let json: any;
        try {
          json = JSON.parse(lineWithoutData);
        } catch {
          streamChoicesLogger.error(this.ctx, 'Error parsing JSON stream data', dataLine);
          continue;
        }

        if (json.copilot_confirmation && isCopilotConfirmation(json.copilot_confirmation)) {
          await finishedCb('', { text: '', copilotConfirmation: json.copilot_confirmation });
        }

        if (json.copilot_references) {
          await finishedCb('', { text: '', copilotReferences: json.copilot_references });
        }

        if (json.choices === undefined) {
          if (!json.copilot_references && !json.copilot_confirmation) {
            if (json.error !== undefined) {
              streamChoicesLogger.error(this.ctx, 'Error in response:', json.error.message);
            } else {
              streamChoicesLogger.error(this.ctx, 'Unexpected response with no choices or error: ' + lineWithoutData);
            }
          }

          if (json.copilot_errors) {
            await finishedCb('', { text: '', copilotErrors: json.copilot_errors });
          }

          continue;
        }

        if (
          // created === 0 or created==='0'
          this.requestId.created == 0
        ) {
          this.requestId = getRequestId(this.response, json);
          if (this.requestId.created === 0) {
            if (json.choices?.length) {
              streamChoicesLogger.error(
                this.ctx,
                'Request id invalid, should have "completionId" and "created":',
                this.requestId
              );
            }
          }
        }

        if (model === undefined && json.model) {
          model = json.model;
        }

        if (usage === undefined && json.usage) {
          usage = json.usage;
        }

        if (this.allSolutionsDone() && this.fastCancellation) {
          break networkRead;
        }

        // for (let i = 0; i < json.choices?.length ?? 0; i++) {
        // const choice = json.choices[i];
        for (const choice of json.choices ?? []) {
          streamChoicesLogger.debug(this.ctx, 'choice', choice);
          this.stats.add(choice.index);

          if (!(choice.index in this.solutions)) {
            this.solutions[choice.index] = new APIJsonDataStreaming();
          }

          const solution = this.solutions[choice.index];
          if (!solution) continue;

          solution.append(choice);
          let finishOffset: Completion['finishOffset'] | undefined;
          // const hasNewLine = choice.text?.indexOf('\n') > -1 || choice.delta?.content?.indexOf('\n') > -1;
          const hasNewLine = choice.text?.includes('\n') || choice.delta?.content?.includes('\n');

          // if (
          //   (choice.finish_reason || hasNewLine) &&
          //     ((finishOffset = await finishedCb(solution.text.join(''), solution.copilot_annotations)),
          //      this.maybeCancel('after awaiting finishedCb'))
          // )
          //   return;
          if (choice.finish_reason || hasNewLine) {
            let text = solution.text.join('');
            finishOffset = await finishedCb(text, {
              text,
              annotations: solution.copilot_annotations,
              copilotReferences: solution.copilot_references,
            });
            if (this.maybeCancel('after awaiting finishedCb')) return;
          }

          if (choice.finish_reason && solution.function_call.name !== undefined) {
            currentFinishReason = choice.finish_reason;
            continue;
          }

          if (!choice.finish_reason && finishOffset === undefined) continue;

          const loggedReason = choice.finish_reason ?? 'client-trimmed';
          telemetry(
            this.ctx,
            'completion.finishReason',
            this.telemetryData.extendedBy({
              completionChoiceFinishReason: loggedReason,
              engineName: model ?? '',
            })
          );

          if (this.dropCompletionReasons.includes(choice.finish_reason)) {
            this.solutions[choice.index] = null;
          } else {
            this.stats.markYielded(choice.index);
            yield {
              solution,
              finishOffset,
              reason: choice.finish_reason,
              requestId: this.requestId,
              index: choice.index,
              model,
              usage,
            };
          }
          if (this.maybeCancel('after yielding finished choice')) return;
          this.solutions[choice.index] = null;
        }
      }
    }

    for (const [index, solution] of Object.entries(this.solutions)) {
      const solutionIndex = Number(index);
      if (!solution) continue;
      telemetry(
        this.ctx,
        'completion.finishReason',
        this.telemetryData.extendedBy({
          completionChoiceFinishReason: 'Iteration Done',
          engineName: model ?? '',
        })
      );
      this.stats.markYielded(solutionIndex);
      yield {
        solution,
        finishOffset: undefined,
        reason: 'Iteration Done',
        requestId: this.requestId,
        index: solutionIndex,
        model,
        usage,
      };
      if (this.maybeCancel('after yielding after iteration done')) return;
    }

    if (extraData.length > 0) {
      try {
        const extraDataJson = JSON.parse(extraData);
        if (extraDataJson.error !== undefined) {
          streamChoicesLogger.error(this.ctx, `Error in response: ${extraDataJson.error.message}`, extraDataJson.error);
        }
      } catch {
        streamChoicesLogger.error(this.ctx, `Error parsing extraData: ${extraData}`);
      }
    }
  }

  async *finishSolutions(
    currentFinishReason: string | null,
    model?: string,
    usage?: number
  ): AsyncGenerator<Completion> {
    for (const [index, solution] of Object.entries(this.solutions)) {
      const solutionIndex = Number(index);
      if (!solution) continue;
      this.stats.markYielded(solutionIndex);
      telemetry(
        this.ctx,
        'completion.finishReason',
        this.telemetryData.extendedBy({
          completionChoiceFinishReason: currentFinishReason ?? 'DONE',
          engineName: model ?? '',
        })
      );

      yield {
        solution,
        finishOffset: undefined,
        reason: 'DONE',
        requestId: this.requestId,
        index: solutionIndex,
        model,
        usage,
      };
      if (this.maybeCancel('after yielding on DONE')) return;
    }
  }

  maybeCancel(description: string): boolean {
    if (this.cancellationToken?.isCancellationRequested) {
      streamChoicesLogger.debug(this.ctx, 'Cancelled: ' + description);
      this.cancel();
      return true;
    }
    return false;
  }

  cancel() {
    this.body.destroy();
  }

  allSolutionsDone(): boolean {
    const solutions = Object.values(this.solutions);
    return solutions.length === this.expectedNumChoices && solutions.every((s) => !s);
  }
}

class ChunkStats {
  choices = new Map<number, ChoiceStats>();

  constructor(expectedNumChoices: number) {
    for (let i = 0; i < expectedNumChoices; i++) {
      this.choices.set(i, new ChoiceStats());
    }
  }

  add(choiceIndex: number): void {
    this.choices.get(choiceIndex)?.increment();
  }

  markYielded(choiceIndex: number): void {
    this.choices.get(choiceIndex)?.markYielded();
  }

  toString(): string {
    return Array.from(this.choices.entries())
      .map(([index, stats]) => `${index}: ${stats.yieldedTokens} -> ${stats.seenTokens}`)
      .join(', ');
  }
}

class ChoiceStats {
  yieldedTokens: number = -1;
  seenTokens: number = 0;

  increment(): void {
    this.seenTokens++;
  }

  markYielded(): void {
    this.yieldedTokens = this.seenTokens;
  }
}

export {
  SSEProcessor,
  prepareSolutionForReturn,
  convertToAPIJsonData,
  APIJsonDataStreaming,
  IStreamingData,
  StreamCopilotAnnotations,
};
