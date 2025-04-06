import type { Static } from '@sinclair/typebox';
import type { Range } from 'vscode-languageserver-types';
import type { SolutionHandler as SolutionHandlerNS } from '../../../lib/src/types.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../lib/src/context.ts';

import { SHA256 } from 'crypto-js';
import { NotificationType, ResponseError, CancellationTokenSource } from 'vscode-languageserver/node.js';
import { ExternalTestingPanelCompletionDocuments, runTestSolutions } from './testing/setPanelCompletionDocuments.ts';
import { TestingOptions } from './testingOptions.ts';
import { MergedToken } from '../cancellation.ts';
import { CopilotCompletionCache } from '../copilotCompletionCache.ts';
import { ErrorCode } from '../rpc.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { Service } from '../service.ts';
import { getOpenTextDocumentChecked } from '../textDocument.ts';
import { completionContextForDocument, solutionCountTarget } from '../../../lib/src/copilotPanel/common.ts';
import { SolutionManager, normalizeCompletionText, runSolutions } from '../../../lib/src/copilotPanel/panel.ts';
import { LocationFactory } from '../../../lib/src/textDocument.ts';
import { Type } from '@sinclair/typebox';
import { DocumentUriSchema, PositionSchema } from '../../../types/src/core.ts';
import '../lib/src/ghostText/ghostText.ts';
import type {} from '../../../types/src/index.ts';

const Params = Type.Object({
  doc: Type.Object({ position: PositionSchema, uri: DocumentUriSchema, version: Type.Number() }),
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
      uri: params.doc.uri,
      telemetry: unformattedSolution.telemetryData,
      index: unformattedSolution.choiceIndex,
      position: range.end,
      resultType: 0,
      triggerCategory: 'solution',
      copilotAnnotations: unformattedSolution.copilotAnnotations,
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

async function reportDone(panelId: string, service: Service): Promise<void> {
  await service.connection.sendNotification(new NotificationType('PanelSolutionsDone'), {
    status: 'OK',
    panelId,
  });
}

let cancellationTokenSource: CancellationTokenSource;
async function handleGetPanelCompletionsChecked(
  ctx: Context,
  clientToken: CancellationToken,
  params: ParamsType
): Promise<[{ solutionCountTarget: number }, null] | [null, { code: number; message: string }]> {
  if (cancellationTokenSource) {
    cancellationTokenSource.cancel();
    cancellationTokenSource.dispose();
  }
  cancellationTokenSource = new CancellationTokenSource();
  const token = new MergedToken([clientToken, cancellationTokenSource.token]);
  const position = params.doc.position;
  const range = LocationFactory.range(position, position);
  const solutionHandler = new SolutionHandler(ctx, params, range);
  const testingDocs = ctx.get(ExternalTestingPanelCompletionDocuments);
  if (testingDocs.documents) {
    const documents = testingDocs.documents;
    runTestSolutions(position, documents, solutionHandler);
  } else {
    let textDocument;
    try {
      textDocument = await getOpenTextDocumentChecked(ctx, params.doc, token);
    } catch (e) {
      if (!(e instanceof ResponseError)) throw e;
      switch (e.code) {
        case ErrorCode.CopilotNotAvailable:
        case ErrorCode.ContentModified:
          return produceEmptySolutions(ctx, params);
      }
      throw e;
    }

    solutionHandler.offset = textDocument.offsetAt(position);
    const completionContext = completionContextForDocument(ctx, textDocument, position);
    const solutionManager = new SolutionManager(textDocument, position, completionContext, token, solutionCountTarget);

    runSolutions(ctx, solutionManager, solutionHandler);
  }

  return [{ solutionCountTarget: solutionCountTarget }, null];
}

async function produceEmptySolutions(
  ctx: Context,
  params: ParamsType
): Promise<[{ solutionCountTarget: number }, null]> {
  await reportDone(params.panelId, ctx.get(Service));
  return [{ solutionCountTarget: 0 }, null];
}

class SolutionHandler implements SolutionHandlerNS.ISolutionHandler {
  offset = 0;

  constructor(
    readonly ctx: Context,
    readonly params: ParamsType,
    readonly range: Range
  ) {}

  get service(): Service {
    return this.ctx.get(Service);
  }

  async onSolution(unformattedSolution: SolutionHandlerNS.UnformattedSolution): Promise<void> {
    await this.service.connection.sendNotification(
      PanelSolutionNotification,
      makeSolution(this.ctx, this.params, this.range, this.offset, unformattedSolution)
    );
  }

  async onFinishedNormally(): Promise<void> {
    await reportDone(this.params.panelId, this.service);
  }

  async onFinishedWithError(error: string): Promise<void> {
    await this.service.connection.sendNotification(PanelSolutionsDoneNotification, {
      status: 'Error',
      message: error,
      panelId: this.params.panelId,
    });
  }
}

const handleGetPanelCompletions = addMethodHandlerValidation(Params, handleGetPanelCompletionsChecked);

export { handleGetPanelCompletions };
