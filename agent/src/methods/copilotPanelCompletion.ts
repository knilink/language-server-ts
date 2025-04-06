import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Range } from 'vscode-languageserver-types';
import type { SolutionHandler as SolutionHandlerNS } from '../../../lib/src/types.ts';
import type { Context } from '../../../lib/src/context.ts';
import type { CopilotPanelCompletionParamsType } from '../../../types/src/index.ts';

import { SHA256 } from 'crypto-js';
import { WorkDoneProgress, CancellationTokenSource } from 'vscode-languageserver/node.js';
import { ExternalTestingPanelCompletionDocuments, runTestSolutions } from './testing/setPanelCompletionDocuments.ts';
import { MergedToken } from '../cancellation.ts';
import { didAcceptPanelCompletionItemCommand } from '../commands/panel.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { ErrorCode } from '../rpc.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { Service } from '../service.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { completionContextForDocument, solutionCountTarget } from '../../../lib/src/copilotPanel/common.ts';
import { SolutionManager, normalizeCompletionText, runSolutions } from '../../../lib/src/copilotPanel/panel.ts';
import { CopilotPanelCompletionParams, CopilotPanelCompletionRequest } from '../../../types/src/panelCompletion.ts';
import type {} from '../../../lib/src/ghostText/ghostText.ts';
import type {} from '../../../types/src/index.ts';

// import { } from '../rpc';
// import { } from '../../../lib/src/ghostText/ghostText';

type Completion = {
  range: Range;
  insertText: string;
  command: {
    command: string;
    title: string;
    arguments: [string];
  };
};

function makeCompletion(
  ctx: Context,
  params: CopilotPanelCompletionParamsType,
  offset: number,
  unformattedSolution: SolutionHandlerNS.UnformattedSolution,
  displayPosition: number
): Completion {
  const normalizedText = normalizeCompletionText(unformattedSolution.completionText);
  const id = SHA256(normalizedText).toString();

  ctx.get(CopilotCompletionCache).set(id, {
    displayText: unformattedSolution.completionText,
    insertText: unformattedSolution.insertText,
    offset: offset,
    uuid: id,
    range: unformattedSolution.range,
    uri: params.textDocument.uri,
    telemetry: unformattedSolution.telemetryData.extendedBy({}, { rank: displayPosition - 1 }),
    index: unformattedSolution.choiceIndex,
    position: params.position,
    resultType: 0,
    triggerCategory: 'solution',
    copilotAnnotations: unformattedSolution.copilotAnnotations,
  });

  return {
    range: unformattedSolution.range,
    insertText: unformattedSolution.insertText,
    command: {
      command: didAcceptPanelCompletionItemCommand,
      title: `Accept completion ${displayPosition}`,
      arguments: [id],
    },
  };
}

function progressMessage(countReceived: number, countTarget: number): string {
  return `${countReceived}/${countTarget}`;
}

async function reportDone(token: string | number | undefined, service: Service, count: number = 0): Promise<void> {
  if (token !== undefined) {
    await service.connection.sendProgress(WorkDoneProgress.type, token, {
      kind: 'end',
      message: progressMessage(count, solutionCountTarget),
    });
  }
}

async function handleChecked(
  ctx: Context,
  token: CancellationToken,
  params: CopilotPanelCompletionParamsType
): Promise<[{ items: Completion[] }, null] | [null, { code: number; message: string }]> {
  const textDocument = await getOpenTextDocumentChecked(ctx, params.textDocument, token);
  let position = params.position;

  if (params.workDoneToken !== undefined) {
    await ctx.get(Service).connection.sendProgress(WorkDoneProgress.type, params.workDoneToken, {
      kind: 'begin',
      title: 'GitHub Copilot Completions Panel',
      cancellable: true,
      message: progressMessage(0, solutionCountTarget),
      percentage: 0,
    });
  }

  const items: Completion[] = [];
  const { partialResultToken } = params;
  const onCompletion =
    partialResultToken === undefined
      ? async (solution: Completion) => {
          items.push(solution);
        }
      : async (solution: Completion) => {
          await ctx
            .get(Service)
            .connection.sendProgress(CopilotPanelCompletionRequest.partialResult, partialResultToken, {
              items: [solution],
            });
        };

  const solutionHandler = new SolutionHandler(ctx, params, onCompletion);

  const testingDocs = ctx.get(ExternalTestingPanelCompletionDocuments);
  if (testingDocs.documents) {
    const documents = testingDocs.documents;
    await runTestSolutions(position, documents, solutionHandler);
  } else {
    solutionHandler.offset = textDocument.offsetAt(position);
    const completionContext = completionContextForDocument(ctx, textDocument, position);
    const solutionManager = new SolutionManager(textDocument, position, completionContext, token, solutionCountTarget);
    await runSolutions(ctx, solutionManager, solutionHandler);
  }

  return solutionHandler.error !== undefined
    ? [null, { code: ErrorCode.InternalError, message: solutionHandler.error }]
    : [{ items }, null];
}

let cancellationTokenSource: CancellationTokenSource | undefined;

async function handleCheckedWithAbort(
  ctx: Context,
  clientToken: CancellationToken,
  params: CopilotPanelCompletionParamsType
): Promise<[{ items: Completion[] }, null] | [null, { code: number; message: string }]> {
  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }
  cancellationTokenSource = new CancellationTokenSource();
  const serverToken = cancellationTokenSource.token;
  const token = new MergedToken([clientToken, serverToken]);

  try {
    return await handleChecked(ctx, token, params);
  } catch (e) {
    if (serverToken.isCancellationRequested && !clientToken.isCancellationRequested) {
      return [null, { code: ErrorCode.ServerCancelled, message: 'Request was superseded by a new request' }];
    }
    throw e;
  }
}

const type = CopilotPanelCompletionRequest.type;

class SolutionHandler implements SolutionHandlerNS.ISolutionHandler {
  offset = 0;
  count = 0;
  items = new Map<
    string, // command id
    Completion
  >();
  error?: string;

  constructor(
    readonly ctx: Context,
    readonly params: CopilotPanelCompletionParamsType,
    readonly onCompletion: (solution: Completion) => Promise<void>
  ) {}

  get service(): Service {
    return this.ctx.get(Service);
  }

  async onSolution(unformattedSolution: SolutionHandlerNS.UnformattedSolution): Promise<void> {
    this.count += 1;
    const completion = makeCompletion(this.ctx, this.params, this.offset, unformattedSolution, this.items.size + 1);
    if (!this.items.has(completion.command.arguments[0])) {
      this.items.set(completion.command.arguments[0], completion);
      await this.onCompletion(completion);
    }

    if (this.params.workDoneToken !== undefined) {
      await this.service.connection.sendProgress(WorkDoneProgress.type, this.params.workDoneToken, {
        kind: 'report',
        message: progressMessage(this.count, solutionCountTarget),
        percentage: Math.round((100 * this.count) / solutionCountTarget),
      });
    }
  }

  async onFinishedNormally(): Promise<void> {
    await reportDone(this.params.workDoneToken, this.service, this.count);
  }

  async onFinishedWithError(error: string): Promise<void> {
    this.error = error;
    if (this.params.workDoneToken !== undefined) {
      await this.service.connection.sendProgress(WorkDoneProgress.type, this.params.workDoneToken, {
        kind: 'end',
        message: `Error: ${error}`,
      });
    }
  }
}

const handle = addMethodHandlerValidation(CopilotPanelCompletionParams, handleCheckedWithAbort);

export { handle, type };
