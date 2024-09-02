import { Type, type Static } from '@sinclair/typebox';
import SHA256 from 'crypto-js/sha256.js';
import { type CancellationToken, CancellationTokenSource, MergedToken } from '../cancellation.ts';
import { URI } from 'vscode-uri';
import { WorkDoneProgress, ProtocolRequestType, ProgressType } from 'vscode-languageserver';
import { Range } from 'vscode-languageserver-types';
import { SolutionHandler as SolutionHandlerNS } from '../../../lib/src/types.ts';
import { Context } from '../../../lib/src/context.ts';
import { normalizeCompletionText, runSolutions, SolutionManager } from '../../../lib/src/copilotPanel/panel.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { solutionCountTarget, completionContextForDocument } from '../../../lib/src/copilotPanel/common.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { verifyAuthenticated } from '../auth/authDecorator.ts';
import { Service } from '../service.ts';
import { PanelCompletionDocuments, runTestSolutions } from './testing/setPanelCompletionDocuments.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { Logger, LogLevel } from '../../../lib/src/logger.ts';
import { didAcceptPanelCompletionItemCommand } from '../commands/panel.ts';

// import { } from '../rpc';
// import { } from '../../../lib/src/ghostText/ghostText';
import { type TelemetryWithExp } from '../../../lib/src/telemetry.ts';

type Completion = {
  range: Range;
  insertText: string;
  command: {
    command: string;
    title: string;
    arguments: [string];
  };
};

const Params = Type.Object({
  textDocument: Type.Object({ uri: Type.String(), version: Type.Optional(Type.Integer()) }),
  position: Type.Object({ line: Type.Integer({ minimum: 0 }), character: Type.Integer({ minimum: 0 }) }),
  partialResultToken: Type.Optional(Type.Union([Type.Integer(), Type.String()])),
  workDoneToken: Type.Optional(Type.Union([Type.Integer(), Type.String()])),
});

const type = new ProtocolRequestType('textDocument/copilotPanelCompletion');

function makeCompletion(
  ctx: Context,
  params: Static<typeof Params>,
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
    file: URI.parse(params.textDocument.uri),
    telemetry: unformattedSolution.telemetryData,
    index: unformattedSolution.choiceIndex,
    position: params.position,
    resultType: 0,
    triggerCategory: 'solution',
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

async function reportDone(token: string | number | undefined, service: Service, count: number = 0) {
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
  params: Static<typeof Params>
): Promise<[{ items: Completion[] }, null] | [null, { code: number; message: string }]> {
  const docResultPromise = getOpenTextDocumentChecked(ctx, params.textDocument.uri);
  await verifyAuthenticated(ctx, token);
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
          await ctx.get(Service).connection.sendProgress(PanelCompletionRequest.partialResult, partialResultToken, {
            items: [solution],
          });
        };

  const solutionHandler = new SolutionHandler(ctx, params, onCompletion);
  let testingDocs;

  try {
    testingDocs = ctx.get(PanelCompletionDocuments);
  } catch {}

  if (testingDocs) {
    const documents = testingDocs.documents;
    runTestSolutions(position, documents, solutionHandler);
  } else {
    let result = await docResultPromise;
    if (result.status === 'notfound') return [null, { code: -32602, message: result.message }];
    if (result.status === 'invalid') return [null, { code: 1002, message: result.reason }];

    const textDocument = result.document;
    if (params.textDocument.version !== undefined && params.textDocument.version !== textDocument.version) {
      new Logger(LogLevel.DEBUG, type.method).debug(
        ctx,
        `Producing empty solutions due to document version mismatch. Panel completions requested for document version ${params.textDocument.version} but document version was ${textDocument.version}.`
      );
      return [null, { code: -32801, message: 'Document Version Mismatch' }];
    }

    solutionHandler.offset = textDocument.offsetAt(position);
    const completionContext = completionContextForDocument(ctx, textDocument, position);
    const solutionManager = new SolutionManager(textDocument, position, completionContext, token, solutionCountTarget);
    await runSolutions(ctx, solutionManager, solutionHandler);
  }

  await new Promise((resolve) => setTimeout(resolve, 0)); // MARK guess is to to wait for onCompletion
  return solutionHandler.error !== undefined
    ? [null, { code: -32603, message: solutionHandler.error }]
    : [{ items }, null];
}

let cancellationTokenSource: CancellationTokenSource | undefined;

async function handleCheckedWithAbort(
  ctx: Context,
  clientToken: CancellationToken,
  params: Static<typeof Params>
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
      return [null, { code: -32802, message: 'Request was superseded by a new request' }];
    }
    throw e;
  }
}

class PanelCompletionRequest {
  static type = type;
  static partialResult = new ProgressType<{ items: Completion[] }>();
}

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
    readonly params: Static<typeof Params>,
    readonly onCompletion: (solution: Completion) => Promise<void>
  ) {}

  get service(): Service {
    return this.ctx.get(Service);
  }

  onSolution(unformattedSolution: SolutionHandlerNS.UnformattedSolution) {
    this.count += 1;
    const completion = makeCompletion(this.ctx, this.params, this.offset, unformattedSolution, this.items.size + 1);
    if (!this.items.has(completion.command.arguments[0])) {
      this.items.set(completion.command.arguments[0], completion);
      this.onCompletion(completion);
    }

    if (this.params.workDoneToken !== undefined) {
      this.service.connection.sendProgress(WorkDoneProgress.type, this.params.workDoneToken, {
        kind: 'report',
        message: progressMessage(this.count, solutionCountTarget),
        percentage: Math.round((100 * this.count) / solutionCountTarget),
      });
    }
  }

  onFinishedNormally() {
    reportDone(this.params.workDoneToken, this.service, this.count);
  }

  onFinishedWithError(error: string) {
    this.error = error;
    if (this.params.workDoneToken !== undefined) {
      this.service.connection.sendProgress(WorkDoneProgress.type, this.params.workDoneToken, {
        kind: 'end',
        message: `Error: ${error}`,
      });
    }
  }
}

const handle = addMethodHandlerValidation(Params, handleCheckedWithAbort);

export { handle, type };
