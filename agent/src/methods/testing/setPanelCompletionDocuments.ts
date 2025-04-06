import { Type, type Static } from '@sinclair/typebox';
import { Position } from 'vscode-languageserver-types';

import { type Context } from '../../../../lib/src/context.ts';
import { type CancellationToken } from 'vscode-languageserver/node.js';
import { SolutionHandler } from '../../../../lib/src/types.ts';

import { v4 as uuidv4 } from 'uuid';
import { parseChallengeDoc } from '../../testing/challengeDoc.ts';
import { TelemetryWithExp } from '../../../../lib/src/telemetry.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';

async function runTestSolutions(
  position: Position,
  docs: { text: string; score: number }[],
  solutionHandler: SolutionHandler.ISolutionHandler
): Promise<void> {
  let headerRequestId = uuidv4();
  for (let solutionIndex = 0; solutionIndex < docs.length && solutionIndex < 10; solutionIndex++) {
    const { text, score } = docs[solutionIndex];
    const { cursorLine, lines, start } = parseChallengeDoc(text, position);
    const completion = [cursorLine.slice(Math.min(start.character, position.character))]
      .concat(lines.slice(position.line + 1))
      .join('\n');

    solutionHandler.offset =
      lines.slice(0, position.line).reduce((a: number, b: string) => a + b.length + 1, 0) + start.character;

    await solutionHandler.onSolution({
      requestId: {
        headerRequestId,
        completionId: uuidv4(),
        created: 0,
        serverExperiments: '',
        deploymentId: '',
      },
      completionText: completion,
      insertText: completion,
      range: { start: position, end: position },
      meanProb: score,
      meanLogProb: -1,
      choiceIndex: solutionIndex,
      telemetryData: TelemetryWithExp.createEmptyConfigForTesting(),
    });
  }
  await solutionHandler.onFinishedNormally();
}

async function handleTestingSetPanelCompletionDocumentsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.forceSet(ExternalTestingPanelCompletionDocuments, new ExternalTestingPanelCompletionDocuments(params.documents));
  return ['OK', null];
}

const PanelCompletionDocument = Type.Object({ text: Type.String(), score: Type.Number() });
const Params = Type.Object({
  documents: Type.Array(PanelCompletionDocument),
  options: Type.Optional(Type.Object({})),
});

class ExternalTestingPanelCompletionDocuments {
  constructor(public documents?: { text: string; score: number }[]) {}
}

const handleTestingSetPanelCompletionDocuments = addMethodHandlerValidation(
  Params,
  handleTestingSetPanelCompletionDocumentsChecked
);

export { ExternalTestingPanelCompletionDocuments, handleTestingSetPanelCompletionDocuments, runTestSolutions };
