import { Type, type Static } from '@sinclair/typebox';
import { URI } from 'vscode-uri';
import SHA256 from "crypto-js/sha256.js";
import { Range } from 'vscode-languageserver-types';
import { NotificationType } from 'vscode-languageserver';

import { SolutionHandler as SolutionHandlerNS } from '../../../lib/src/types.ts';
import { type CancellationToken } from '../cancellation.ts';
import { type Context } from '../../../lib/src/context.ts';

import { normalizeCompletionText, runSolutions, SolutionManager } from '../../../lib/src/copilotPanel/panel.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { verifyAuthenticated } from '../auth/authDecorator.ts';
import { LocationFactory } from '../../../lib/src/textDocument.ts';
import { PanelCompletionDocuments, runTestSolutions } from './testing/setPanelCompletionDocuments.ts';

import { completionContextForDocument, solutionCountTarget } from '../../../lib/src/copilotPanel/common.ts';
import { Service } from '../service.ts';
import { TestingOptions } from './testingOptions.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { CancellationTokenSource, MergedToken } from '../cancellation.ts';
import { Logger, LogLevel } from '../../../lib/src/logger.ts';

const Params = Type.Object({
  doc: Type.Object({
    position: Type.Object({ line: Type.Number({ minimum: 0 }), character: Type.Number({ minimum: 0 }) }),
    uri: Type.String(),
    version: Type.Number(),
  }),
  panelId: Type.String(),
  options: Type.Optional(TestingOptions),
});
type ParamsType = Static<typeof Params>;

const PanelSolutionNotification = new NotificationType('PanelSolution');
const PanelSolutionsDoneNotification = new NotificationType('PanelSolutionsDone');

function makeSolution(
  ctx: Context,
  params: ParamsType,
  range: Range,
  offset: number,
  unformattedSolution: SolutionHandlerNS.UnformattedSolution
) {
  const normalizedText = normalizeCompletionText(unformattedSolution.completionText);
  const solutionId = SHA256(normalizedText).toString();

  return (
    ctx.get(CopilotCompletionCache).set(solutionId, {
      displayText: unformattedSolution.insertText,
      insertText: unformattedSolution.completionText,
      offset: offset,
      uuid: solutionId,
      range: range,
      file: URI.parse(params.doc.uri),
      telemetry: unformattedSolution.telemetryData,
      index: unformattedSolution.choiceIndex,
      position: range.end,
      resultType: 0,
      triggerCategory: 'solution',
    }),
    {
      panelId: params.panelId,
      range: range,
      completionText: unformattedSolution.completionText,
      displayText: unformattedSolution.insertText,
      score: unformattedSolution.meanProb,
      solutionId: solutionId,
    }
  );
}

async function reportDone(panelId: string, service: Service) {
  service.connection.sendNotification(PanelSolutionsDoneNotification, {
    status: 'OK',
    panelId: panelId,
  });
}

let cancellationTokenSource: CancellationTokenSource;
async function handleGetPanelCompletionsChecked(
  ctx: Context,
  clientToken: CancellationToken,
  params: ParamsType
): Promise<[{ solutionCountTarget: number }, null] | [null, { code: number; message: string }]> {
  const docResultPromise = getOpenTextDocumentChecked(ctx, params.doc.uri);
  await verifyAuthenticated(ctx, clientToken);

  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }
  cancellationTokenSource = new CancellationTokenSource();
  const token = new MergedToken([clientToken, cancellationTokenSource.token]);
  const position = params.doc.position;
  const range = LocationFactory.range(position, position);
  const solutionHandler = new SolutionHandler(ctx, params, range);
  let testingDocs: PanelCompletionDocuments | undefined;

  try {
    testingDocs = ctx.get(PanelCompletionDocuments);
  } catch { }

  if (testingDocs) {
    const documents = testingDocs.documents;
    setImmediate(() => runTestSolutions(position, documents, solutionHandler));
  } else {
    const result = await docResultPromise;
    if (result.status === 'notfound') return [null, { code: -32602, message: result.message }];
    if (result.status === 'invalid') return produceEmptySolutions(ctx, params);
    const textDocument = result.document;

    if (textDocument.version !== params.doc.version) {
      new Logger(LogLevel.DEBUG, 'getPanelCompletions').debug(
        ctx,
        `Producing empty solutions due to document version mismatch. Panel completions requested for document version ${params.doc.version} but document version was ${textDocument.version}.`
      );
      return produceEmptySolutions(ctx, params);
    }

    solutionHandler.offset = textDocument.offsetAt(position);
    const completionContext = completionContextForDocument(ctx, textDocument, position);
    const solutionManager = new SolutionManager(textDocument, position, completionContext, token, solutionCountTarget);

    setImmediate(() => runSolutions(ctx, solutionManager, solutionHandler));
  }

  return [{ solutionCountTarget: solutionCountTarget }, null];
}

function produceEmptySolutions(ctx: Context, params: ParamsType): [{ solutionCountTarget: number }, null] {
  reportDone(params.panelId, ctx.get(Service));
  return [{ solutionCountTarget: 0 }, null];
}

class SolutionHandler implements SolutionHandlerNS.ISolutionHandler {
  offset = 0;

  constructor(
    readonly ctx: Context,
    readonly params: ParamsType,
    readonly range: Range
  ) { }

  get service(): Service {
    return this.ctx.get(Service);
  }

  onSolution(unformattedSolution: SolutionHandlerNS.UnformattedSolution) {
    this.service.connection.sendNotification(
      PanelSolutionNotification,
      makeSolution(this.ctx, this.params, this.range, this.offset, unformattedSolution)
    );
  }

  onFinishedNormally() {
    reportDone(this.params.panelId, this.service);
  }

  onFinishedWithError(error: string) {
    this.service.connection.sendNotification(PanelSolutionsDoneNotification, {
      status: 'Error',
      message: error,
      panelId: this.params.panelId,
    });
  }
}

const handleGetPanelCompletions = addMethodHandlerValidation(Params, handleGetPanelCompletionsChecked);

export { handleGetPanelCompletions };
